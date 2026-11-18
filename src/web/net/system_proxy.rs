//! The proxy settings of the system. Reading them blocks.

use bun_core::strings;

use super::proxy::Config;

#[derive(Default)]
struct Parts<'p> {
    http: &'p [u8],
    https: &'p [u8],
    socks: &'p [u8],
    bypass: &'p [u8],
    script: &'p [u8],
    detects: bool,
}

impl From<Parts<'_>> for Config {
    fn from(it: Parts<'_>) -> Config {
        let rules = [
            (&b"http="[..], it.http),
            (b"https=", it.https),
            (b"socks=socks5://", it.socks),
        ];
        let rules: Vec<_> = rules
            .iter()
            .filter(|it| !it.1.is_empty())
            .map(|it| [it.0, it.1].concat())
            .collect();
        match () {
            () if !it.script.is_empty() => Config::Script {
                url: it.script.into(),
                is_optional: true,
            },
            () if !rules.is_empty() => Config::Fixed {
                rules: rules.join(&b';').into(),
                bypass: it.bypass.into(),
            },
            () if it.detects => Config::AutoDetect,
            () => Config::Direct,
        }
    }
}

fn variable(name: &str) -> Option<&'static [u8]> {
    bun_core::getenv_z(&bun_core::ZBox::from_bytes(name.as_bytes())).filter(|it| !it.is_empty())
}

fn from_environment() -> Config {
    let get = |name: &str| variable(name).or_else(|| variable(&name.to_ascii_uppercase()));
    let with_subdomains = |rule: &[u8]| {
        let is_suffix = rule[0].is_ascii_alphanumeric() && !strings::contains_char(rule, b'/');
        [if is_suffix { &b"*"[..] } else { b"" }, rule].concat()
    };
    let bypass: Vec<_> = strings::tokenize_any(get("no_proxy").unwrap_or_default(), b"\t\n ,")
        .map(with_subdomains)
        .collect();
    let [http, https] = ["http_proxy", "https_proxy"]
        .map(|it| get("all_proxy").or_else(|| get(it)).unwrap_or_default());
    Parts {
        http,
        https,
        bypass: &bypass.join(&b','),
        script: get("auto_proxy").unwrap_or_default(),
        ..Default::default()
    }
    .into()
}

pub(super) fn read() -> Config {
    platform::read().unwrap_or_else(from_environment)
}

#[cfg(unix)]
mod command {
    use bun_core::{CStringList, strings};
    use bun_spawn_sys::posix_spawn::posix_spawn::wait4;
    use bun_spawn_sys::{PosixSpawnOptions, PosixStdio, spawn_process_posix};

    const TIMEOUT_MS: i32 = 5000;

    pub(super) fn output_of(command: &[&[u8]]) -> Option<Vec<u8>> {
        bun_ui::can_start_programs().then_some(())?;
        let options = PosixSpawnOptions {
            stdin: PosixStdio::Ignore,
            stdout: PosixStdio::Buffer,
            stderr: PosixStdio::Ignore,
            sync: true,
            ..Default::default()
        };
        let child = spawn_process_posix(
            &options,
            CStringList::from_parts(command.iter().map(|it| [*it])).as_list(),
            None,
        )
        .ok()?
        .ok()?;
        let (mut output, mut buffer) = (Vec::new(), [0; 4096]);
        let has_ended = child.stdout.as_ref().is_some_and(|pipe| {
            loop {
                let mut waiting = [bun_sys::posix::PollFd {
                    fd: pipe.fd().native(),
                    events: bun_sys::posix::POLL_IN,
                    revents: 0,
                }];
                match bun_sys::posix::poll(&mut waiting, TIMEOUT_MS)
                    .ok()
                    .filter(|it| *it > 0)
                    .and_then(|_| pipe.read(&mut buffer).ok())
                {
                    Some(0) => break true,
                    Some(count) => output.extend_from_slice(&buffer[..count]),
                    None => break false,
                }
            }
        });
        if !has_ended {
            bun_spawn_sys::ffi::kill(child.pid, 9);
        }
        (wait4(child.pid, 0, None).ok()?.status == 0).then_some(output)
    }

    /// What follows `name` in the line that starts with it.
    pub(super) fn value_of<'t>(text: &'t [u8], name: &str) -> &'t [u8] {
        strings::split(text, b"\n")
            .find_map(|it| it.trim_ascii().strip_prefix(name.as_bytes()))
            .unwrap_or_default()
            .trim_ascii()
    }

    pub(super) fn address(host: &[u8], port: &[u8]) -> Vec<u8> {
        match (host, port) {
            (b"", _) | (_, b"0") => Vec::new(),
            (_, b"") => [host, b":80"].concat(),
            _ => [host, b":", port].concat(),
        }
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod platform {
    use super::command::{address, output_of, value_of};
    use super::*;

    fn from_gnome() -> Option<Config> {
        let mut path = bun_paths::path_buffer_pool::get();
        let program = bun_which::which(&mut path, variable("PATH")?, b"/", b"gsettings")?;
        let mut text = output_of(&[
            program.as_bytes(),
            b"list-recursively",
            b"org.gnome.system.proxy",
        ])?;
        text.retain(|it| !matches!(it, b'\'' | b'[' | b']'));
        let get = |name: &str| value_of(&text, &format!("org.gnome.system.proxy{name} "));
        let [http, https, socks] = ["http", "https", "socks"]
            .map(|it| address(get(&format!(".{it} host")), get(&format!(".{it} port"))));
        Some(match get(" mode") {
            b"auto" => Parts {
                script: get(" autoconfig-url"),
                detects: true,
                ..Default::default()
            }
            .into(),
            b"manual" => Parts {
                http: &http,
                https: &https,
                socks: &socks,
                bypass: strings::trim_prefix(get(" ignore-hosts"), b"@as"),
                ..Default::default()
            }
            .into(),
            _ => Config::Direct,
        })
    }

    fn from_kde() -> Option<Config> {
        let directory = variable("XDG_CONFIG_HOME")
            .map(<[u8]>::to_vec)
            .or_else(|| Some([variable("HOME")?, b"/.config"].concat()))?;
        let text =
            bun_sys::File::read_from(bun_sys::Fd::cwd(), &[&*directory, b"/kioslaverc"].concat())
                .ok()?;
        let get = |name: &str| {
            strings::split_once_char(value_of(&text, name), b'=').map_or(&b""[..], |it| it.1)
        };
        let [http, https, socks] = ["httpProxy", "httpsProxy", "socksProxy"]
            .map(|it| strings::replace_owned(get(it), b" ", b":"));
        match get("ProxyType") {
            b"1" => Some(
                Parts {
                    http: &http,
                    https: &https,
                    socks: strings::trim_prefix(&socks, b"socks://"),
                    bypass: get("NoProxyFor"),
                    ..Default::default()
                }
                .into(),
            ),
            b"2" => Some(
                Parts {
                    script: get("Proxy Config Script"),
                    detects: true,
                    ..Default::default()
                }
                .into(),
            ),
            b"3" => Some(Config::AutoDetect),
            b"4" => None,
            _ => Some(Config::Direct),
        }
    }

    pub(super) fn read() -> Option<Config> {
        let desktop = variable("XDG_CURRENT_DESKTOP")?.to_ascii_lowercase();
        let is_one_of = |names: &[&str]| {
            names
                .iter()
                .any(|it| strings::contains(&desktop, it.as_bytes()))
        };
        match () {
            () if is_one_of(&["kde"]) => from_kde(),
            () if is_one_of(&["gnome", "unity", "cinnamon", "pantheon", "deepin", "ukui"]) => {
                from_gnome()
            }
            () => None,
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::command::{address, output_of, value_of};
    use super::*;

    pub(super) fn read() -> Option<Config> {
        let text = output_of(&[b"/usr/sbin/scutil", b"--proxy"])?;
        let get = |name: &str| value_of(&text, &format!("{name} : "));
        let if_set = |flag: &str, value| if get(flag) == b"1" { value } else { &b""[..] };
        let [http, https, socks] = ["HTTP", "HTTPS", "SOCKS"].map(|it| {
            address(
                if_set(&format!("{it}Enable"), get(&format!("{it}Proxy"))),
                get(&format!("{it}Port")),
            )
        });
        let exceptions = strings::split_once(&text, b"ExceptionsList : <array> {")
            .and_then(|it| strings::split_once_char(it.1, b'}'))
            .map_or(&b""[..], |it| it.0);
        let bypass = strings::split(exceptions, b"\n")
            .filter_map(|it| Some(strings::split_once(it, b" : ")?.1));
        let bypass = bypass
            .chain([if_set("ExcludeSimpleHostnames", b"<local>")])
            .collect::<Vec<_>>()
            .join(&b',');
        let script = if_set("ProxyAutoConfigEnable", get("ProxyAutoConfigURLString"));
        Some(
            Parts {
                http: &http,
                https: &https,
                socks: &socks,
                bypass: &bypass,
                script,
                detects: get("ProxyAutoDiscoveryEnable") == b"1",
            }
            .into(),
        )
    }
}

#[cfg(windows)]
mod platform {
    use core::ffi::c_void;

    use super::*;

    unsafe extern "system" {
        fn RegGetValueW(
            key: isize,
            path: *const u16,
            name: *const u16,
            flags: u32,
            kind: *mut u32,
            data: *mut c_void,
            size: *mut u32,
        ) -> i32;
    }

    fn value_of(below: &str, name: &str) -> Vec<u16> {
        const CURRENT_USER: isize = 0x8000_0001_u32 as i32 as isize;
        const ANY_TYPE: u32 = 0xffff;
        let wide = |text: &str| text.encode_utf16().chain([0]).collect::<Vec<_>>();
        let path = wide(&format!(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings{below}"
        ));
        let (mut data, mut size) = (vec![0u16; 8192], 16384);
        // SAFETY: the strings end with a zero, and `data` has `size` bytes.
        let status = unsafe {
            RegGetValueW(
                CURRENT_USER,
                path.as_ptr(),
                wide(name).as_ptr(),
                ANY_TYPE,
                core::ptr::null_mut(),
                data.as_mut_ptr().cast(),
                &raw mut size,
            )
        };
        data.truncate(if status == 0 { size as usize / 2 } else { 0 });
        data
    }

    pub(super) fn read() -> Option<Config> {
        const DETECTS: u16 = 8;
        let text = |name| {
            String::from_utf16_lossy(&value_of("", name))
                .trim_end_matches('\0')
                .as_bytes()
                .to_vec()
        };
        let script = text("AutoConfigURL");
        if script.is_empty() && value_of("", "ProxyEnable").first() == Some(&1) {
            return Some(Config::Fixed {
                rules: text("ProxyServer").into(),
                bypass: text("ProxyOverride").into(),
            });
        }
        let detects = value_of("\\Connections", "DefaultConnectionSettings")
            .get(4)
            .is_some_and(|it| it & DETECTS != 0);
        Some(
            Parts {
                script: &script,
                detects,
                ..Default::default()
            }
            .into(),
        )
    }
}
