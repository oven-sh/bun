#!/bin/bash
# mkwork.sh <name>: a scratch copy of the crate and of the harness, at /root/zstd-ref/work/<name>/{zstd,harness}
set -e
name=$1; w=/root/zstd-ref/work/$name
mkdir -p $w && rm -rf $w/zstd $w/harness
cp -r /root/repos/oven-sh/bun/src/zstd $w/zstd
cp /root/zstd-ref/template/testing.rs $w/zstd/testing.rs
echo 'pub mod testing;' >> $w/zstd/lib.rs
python3 -I - "$w" <<'PY'
import re,sys
w=sys.argv[1]
root=open('/root/repos/oven-sh/bun/Cargo.toml').read()
def table(name):
    m=re.search(r'^\[workspace\.lints\.'+name+r'\]\n(.*?)(?=^\[)',root,re.S|re.M)
    return m.group(1)
open(w+'/zstd/Cargo.toml','w').write(f'''[package]
name = "bun_zstd"
version = "0.0.0"
edition = "2024"

[lib]
path = "lib.rs"

[dependencies]
strum = {{ version = "0.26", features = ["derive"] }}
bun_pod = {{ path = "/root/repos/oven-sh/bun/src/pod", features = ["alloc"] }}

[workspace]

[lints.rust]
{table("rust")}
[lints.clippy]
{table("clippy")}
''')
PY
cp /root/repos/oven-sh/bun/rust-toolchain.toml /root/repos/oven-sh/bun/clippy.toml /root/repos/oven-sh/bun/rustfmt.toml $w/zstd/ 2>/dev/null || true
mkdir -p $w/harness/src
cp /root/zstd-ref/harness/{Cargo.toml,build.rs,rust-toolchain.toml} $w/harness/
cp /root/zstd-ref/harness/src/{c.rs,data.rs} /root/zstd-ref/template/seqs.rs $w/harness/src/
sed -i "s#/root/repos/oven-sh/bun/src/zstd#$w/zstd#" $w/harness/Cargo.toml
cat > $w/harness/src/main.rs <<'RS'
mod c;
mod data;
mod seqs;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(String::as_str).unwrap_or("");
    let seed: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1);
    let iters: u64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(1000);
    match cmd {
        // seqs <seed> <iters> <strategies, e.g. 1,2> <dict: 0 or 1>
        "seqs" => {
            let strategies: Vec<u32> = args[4].split(',').map(|s| s.parse().unwrap()).collect();
            seqs::run(seed, iters, &strategies, args.get(5).is_some_and(|s| s == "1"));
        }
        _ => eprintln!("unknown command"),
    }
}
RS
echo "$w ready"
