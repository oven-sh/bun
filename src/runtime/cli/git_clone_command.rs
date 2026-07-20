use bstr::BStr;

pub(crate) struct GitCloneCommand;

impl GitCloneCommand {
    pub(crate) fn exec() -> Result<(), bun_core::Error> {
        // argv: [bun, git-clone, <url>, [<dir>], [--no-checkout], [-jN]]
        let argv = bun_core::util::argv();
        let mut url: Option<&'static [u8]> = None;
        let mut dir: Option<&'static [u8]> = None;
        let mut opts = bun_git::CloneOptions::default();
        let mut i = 2;
        while let Some(a) = argv.get(i) {
            i += 1;
            let a = a.as_bytes();
            if a == b"--index-pack" {
                // Benchmark mode: `bun git-clone --index-pack <file.pack>`
                let path = argv.get(i).map(|z| z.as_bytes()).unwrap_or(b"");
                match bun_git::index_pack_file(path) {
                    Ok(h) => {
                        bun_core::prettyln!("{}", h);
                        return Ok(());
                    }
                    Err(e) => {
                        bun_core::pretty_errorln!("<red>error<r>: {}", e);
                        bun_core::Global::exit(1);
                    }
                }
            }
            if let Some(n) = a.strip_prefix(b"-j") {
                opts.jobs = core::str::from_utf8(n)
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                continue;
            }
            if let Some(n) = a.strip_prefix(b"-s") {
                opts.skeleton_slices = core::str::from_utf8(n)
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                continue;
            }
            if a == b"--no-checkout" {
                opts.no_checkout = true;
            } else if a == b"-q" || a == b"--quiet" {
                opts.quiet = true;
            } else if url.is_none() {
                url = Some(a);
            } else if dir.is_none() {
                dir = Some(a);
            } else {
                bun_core::pretty_errorln!("<red>error<r>: unexpected argument: {}", BStr::new(a));
                bun_core::Global::exit(1);
            }
        }
        let Some(url) = url.and_then(|u| core::str::from_utf8(u).ok()) else {
            bun_core::pretty_errorln!(
                "<r>usage: <b>bun git-clone<r> <cyan>\\<url\\><r> [<cyan>\\<dir\\><r>] [--no-checkout]"
            );
            bun_core::Global::exit(1);
        };
        let dir_buf;
        let dir: &[u8] = match dir {
            Some(d) => d,
            None => {
                dir_buf = url
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or("repo")
                    .trim_end_matches(".git")
                    .to_owned();
                dir_buf.as_bytes()
            }
        };
        match bun_git::clone(url, dir, &opts) {
            Ok(head) => {
                if !opts.quiet {
                    bun_core::prettyln!("HEAD is now at <green>{}<r>", head);
                }
                Ok(())
            }
            Err(e) => {
                bun_core::pretty_errorln!("<red>error<r>: clone failed: {}", e);
                bun_core::Global::exit(1);
            }
        }
    }
}
