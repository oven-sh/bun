//! The limits of the control groups that the process is in.
//! <https://docs.kernel.org/admin-guide/cgroup-v2.html>

use bun_core::strings;
use bun_sys::{Fd, File, O};

const MOUNT_POINT: &[u8] = b"/sys/fs/cgroup";

/// Where a controller has the process. The paths have no leading slash.
#[derive(Debug, PartialEq, Eq)]
enum Group<'a> {
    Version1(Option<&'a [u8]>),
    Version2(&'a [u8]),
}

/// A line is `id:controllers:/path`. A controller is in version 2 unless a line of version 1 names it.
fn find_group<'a>(membership: &'a [u8], controller: &[u8]) -> Group<'a> {
    let mut unified = None;
    for line in strings::split(membership, b"\n") {
        let Some((id, rest)) = strings::split_once_char(line, b':') else {
            continue;
        };
        let Some((controllers, path)) = strings::split_once_char(rest, b':') else {
            continue;
        };
        if strings::split(controllers, b",").any(|it| it == controller) {
            return Group::Version1(Some(path.strip_prefix(b"/").unwrap_or(path)));
        }
        if id == b"0" && controllers.is_empty() {
            unified = unified.or_else(|| path.strip_prefix(b"/"));
        }
    }
    unified.map_or(Group::Version1(None), Group::Version2)
}

/// The group, those above it and the root, whose path is empty.
fn ancestors(path: &[u8]) -> impl Iterator<Item = &[u8]> {
    core::iter::successors(Some(path), |path| {
        let parent = strings::last_index_of_char(path, b'/').unwrap_or(0);
        (!path.is_empty()).then(|| &path[..parent])
    })
}

fn read<'a>(path: &[u8], buffer: &'a mut [u8]) -> Option<&'a [u8]> {
    let file = File::openat(Fd::cwd(), path, O::RDONLY | O::CLOEXEC, 0).ok()?;
    let length = file.read(buffer).ok()?;
    Some(buffer[..length].trim_ascii())
}

fn read_setting<T>(
    directories: [&[u8]; 2],
    name: &[u8],
    parse: fn(&[u8]) -> Option<T>,
) -> Option<T> {
    let mut path = MOUNT_POINT.to_vec();
    for part in directories.into_iter().chain([name]) {
        if !part.is_empty() {
            path.push(b'/');
            path.extend_from_slice(part);
        }
    }
    parse(read(&path, &mut [0; 64])?)
}

fn parse_positive(text: &[u8]) -> Option<u64> {
    let number = core::str::from_utf8(text).ok()?.parse().ok()?;
    (number != 0).then_some(number)
}

fn whole_processors(quota: u64, period: u64) -> u64 {
    (quota / period).max(1)
}

fn parse_quota_and_period(text: &[u8]) -> Option<u64> {
    let (quota, period) = strings::split_once_char(text, b' ')?;
    Some(whole_processors(
        parse_positive(quota)?,
        parse_positive(period)?,
    ))
}

fn with_group<T>(controller: &[u8], limit: fn(Group<'_>) -> Option<T>) -> Option<T> {
    let mut buffer = [0; 1024];
    limit(find_group(
        read(b"/proc/self/cgroup", &mut buffer)?,
        controller,
    ))
}

/// In bytes. Version 1 writes a huge number for no limit.
pub(crate) fn memory_limit() -> Option<u64> {
    with_group(b"memory", |group| match group {
        Group::Version1(path) => {
            let limit_of = |path| {
                let read = |name| read_setting([b"memory", path], name, parse_positive);
                Some(read(b"memory.soft_limit_in_bytes")?.min(read(b"memory.limit_in_bytes")?))
            };
            path.and_then(limit_of).or_else(|| limit_of(b""))
        }
        Group::Version2(path) => ancestors(path)
            .flat_map(|path| [(path, &b"memory.max"[..]), (path, b"memory.high")])
            .filter_map(|(path, name)| read_setting([b"", path], name, parse_positive))
            .min(),
    })
}

pub(crate) fn processor_limit() -> Option<u64> {
    with_group(b"cpu", |group| match group {
        Group::Version1(path) => {
            let path = path.unwrap_or_default();
            let read = |name| read_setting([b"cpu", path], name, parse_positive);
            Some(whole_processors(
                read(b"cpu.cfs_quota_us")?,
                read(b"cpu.cfs_period_us")?,
            ))
        }
        Group::Version2(path) => ancestors(path)
            .filter_map(|path| read_setting([b"", path], b"cpu.max", parse_quota_and_period))
            .min(),
    })
}

#[cfg(test)]
mod tests {
    use bun_engine_standalone as _;

    use super::*;

    #[test]
    fn finds_the_hierarchy_of_a_controller() {
        let find = find_group;
        assert_eq!(find(b"0::/", b"cpu"), Group::Version2(b""));
        assert_eq!(
            find(b"0::/a/b.scope", b"cpu"),
            Group::Version2(b"a/b.scope")
        );
        let mixed = b"5:cpuset:/x\n4:cpuacct,cpu:/y\n1:name=systemd:/\n0::/z";
        assert_eq!(find(mixed, b"cpu"), Group::Version1(Some(b"y")));
        assert_eq!(find(mixed, b"memory"), Group::Version2(b"z"));
        assert_eq!(find(b"5:cpuset:/x", b"cpu"), Group::Version1(None));
        assert_eq!(find(b"", b"cpu"), Group::Version1(None));
    }

    #[test]
    fn walks_up_to_the_root_once() {
        let walk = |path| ancestors(path).collect::<Vec<_>>();
        assert_eq!(walk(b"a/b/c"), [&b"a/b/c"[..], b"a/b", b"a", b""]);
        assert_eq!(walk(b""), [b""]);
    }

    #[test]
    fn parses_limits() {
        assert_eq!(parse_positive(b"max"), None);
        assert_eq!(parse_positive(b"-1"), None);
        assert_eq!(parse_positive(b"0"), None);
        assert_eq!(parse_positive(b"4096"), Some(4096));
        assert_eq!(parse_quota_and_period(b"max 100000"), None);
        assert_eq!(parse_quota_and_period(b"250000 100000"), Some(2));
        assert_eq!(parse_quota_and_period(b"50000 100000"), Some(1));
        assert_eq!(parse_quota_and_period(b"50000 0"), None);
    }
}
