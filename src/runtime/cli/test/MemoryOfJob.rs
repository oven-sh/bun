//! The memory that a `bun test --aot` can get, for what it decides by memory: whether what it compiles is one program or several.
//! `--aot-memory-limit` says it. Without the flag it is the least of what the control groups of the process allow and what the
//! machine has free.

use bun_core::strings;
#[cfg(target_os = "linux")]
use bun_sys::{Fd, File};

/// "5GB", "5G", "5gib", "4096MB", "500000000": a whole number and a unit of 1,024 each.
pub(crate) fn parse(text: &[u8]) -> Option<u64> {
    let digits = text.iter().take_while(|byte| byte.is_ascii_digit()).count();
    let number = strings::parse_int::<u64>(&text[..digits], 10).ok()?;
    let unit = text[digits..].trim_ascii().to_ascii_lowercase();
    let shift = match &unit[..] {
        b"" | b"b" => 0,
        b"k" | b"kb" | b"kib" => 10,
        b"m" | b"mb" | b"mib" => 20,
        b"g" | b"gb" | b"gib" => 30,
        b"t" | b"tb" | b"tib" => 40,
        _ => return None,
    };
    number.checked_mul(1 << shift).filter(|&bytes| bytes > 0)
}

#[cfg(target_os = "linux")]
fn read_number(path: &[u8]) -> Option<u64> {
    let text = File::read_from(Fd::cwd(), path).ok()?;
    // "max" where there is no limit.
    strings::parse_int::<u64>(text.trim_ascii(), 10).ok()
}

/// The least limit among the control group of the process and those above it.
#[cfg(target_os = "linux")]
fn limit_of_control_groups() -> Option<u64> {
    let groups = File::read_from(Fd::cwd(), b"/proc/self/cgroup").ok()?;
    let mut least: Option<u64> = None;
    for line in strings::split(&groups, b"\n") {
        // "0::/user.slice/run.scope", and in the older form "9:memory:/docker/abc".
        let Some((_, rest)) = strings::split_once_char(line, b':') else {
            continue;
        };
        let Some((controllers, group)) = strings::split_once_char(rest, b':') else {
            continue;
        };
        let (root, file): (&[u8], &[u8]) = match controllers {
            b"" => (b"/sys/fs/cgroup", b"/memory.max"),
            b"memory" => (b"/sys/fs/cgroup/memory", b"/memory.limit_in_bytes"),
            _ => continue,
        };
        let mut group = group.trim_ascii_end();
        loop {
            group = group.strip_suffix(b"/").unwrap_or(group);
            let limit = read_number(&[root, group, file].concat());
            least = [least, limit].into_iter().flatten().min();
            let Some(slash) = strings::last_index_of_char(group, b'/') else {
                break;
            };
            group = &group[..slash];
        }
    }
    least
}

#[cfg(target_os = "linux")]
fn free_memory_of_machine() -> Option<u64> {
    let text = File::read_from(Fd::cwd(), b"/proc/meminfo").ok()?;
    let line = strings::split(&text, b"\n").find_map(|line| line.strip_prefix(b"MemAvailable:"))?;
    let kilobytes = line.trim_ascii().strip_suffix(b"kB")?.trim_ascii();
    Some(strings::parse_int::<u64>(kilobytes, 10).ok()? << 10)
}

#[cfg(not(target_os = "linux"))]
fn limit_of_control_groups() -> Option<u64> {
    None
}

#[cfg(not(target_os = "linux"))]
fn free_memory_of_machine() -> Option<u64> {
    None
}

/// `told`: `--aot-memory-limit`.
pub(crate) fn find(told: Option<u64>) -> u64 {
    told.unwrap_or_else(|| {
        let free =
            free_memory_of_machine().unwrap_or_else(|| bun_core::get_total_memory_size() as u64);
        limit_of_control_groups().map_or(free, |limit| limit.min(free))
    })
}
