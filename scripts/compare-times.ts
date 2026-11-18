// Temporary: times from JavaScript, in this build and in a build of main.
import { readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { cpus } from "node:os";
import path, { join } from "node:path";
import zlib from "node:zlib";

const repo = join(import.meta.dir, "..");
const [mode, ...rest] = process.argv.slice(2);

if (mode === "child") {
  const read = (...names: string[]) => Buffer.concat(names.map(it => readFileSync(join(repo, it))));
  // Each row has a function of its own, so that the JIT does not mix the call sites.
  const time = (name: string, inputs: unknown[], body: string) => {
    // These take the time of the allocator.
    if (/(toString (ascii|latin1|utf8) \d{3,}|(hex|escapeHTML|escapeHTML utf16|ANSI colored) 65536)$/.test(name))
      return;
    Bun.gc(true);
    const loop = `for (let i = 0, j = 0; i < n; i++) { const x = inputs[j]; if (++j === inputs.length) j = 0; keep[0] = ${body}; }`;
    const run = new Function("path", "zlib", "SourceMap", "keep", "inputs", "n", loop).bind(
      null,
      path.posix,
      zlib,
      SourceMap,
      [],
      inputs,
    );
    let [n, least] = [inputs.length, Infinity];
    run(n);
    for (let t = Bun.nanoseconds(); run(n), Bun.nanoseconds() - t < 3e6; t = Bun.nanoseconds()) n *= 2;
    for (let turn = 0, start = Bun.nanoseconds(); turn < 3 || Bun.nanoseconds() - start < 1.1e8; turn++) {
      const t = Bun.nanoseconds();
      run(n);
      least = Math.min(least, (Bun.nanoseconds() - t) / n);
    }
    console.log(`${name}\t${least.toFixed(1)}`);
  };
  const timeImage = async (name: string, make: () => Bun.Image) => {
    let least = Infinity;
    for (let turn = 0, start = Bun.nanoseconds(); turn < 4 || Bun.nanoseconds() - start < 2e8; turn++) {
      const t = Bun.nanoseconds();
      await make().bytes();
      least = Math.min(least, Bun.nanoseconds() - t);
    }
    console.log(`${name}\t${least}`);
  };

  Bun.Image.backend = "bun";
  const hash = (some: any[][]) => Bun.hash.crc32(Buffer.concat(some.map(([a, b]) => zlib.brotliCompressSync(a, b))));
  const texts = {
    md: read(
      "docs/runtime/http/server.mdx",
      "docs/bundler/index.mdx",
      "docs/runtime/sql.mdx",
      "docs/runtime/s3.mdx",
      "docs/runtime/bunfig.mdx",
      "docs/runtime/utils.mdx",
    ),
    rs: read("src/js_parser/lexer.rs", "src/runtime/api/BunObject.rs"),
    json: read("test/cli/install/migration/contoso-test/package-lock.json"),
    exe: readFileSync(rest[0]).subarray(8 << 20, 9 << 20),
  };
  for (const [kind, all] of Object.entries(texts))
    for (const size of [300, 2000, 20000])
      for (const quality of [10, 11]) {
        const options = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality } };
        const some = [[all.subarray(1000, 1000 + size), options]];
        time(`brotli q${quality} ${size} ${kind} ${hash(some)}`, some, "zlib.brotliCompressSync(x[0], x[1])");
      }
  for (const [kind, all] of Object.entries(texts))
    for (const [size, count] of [
      [300, 100],
      [2000, 30],
    ])
      for (const quality of [1, 5, 10, 11]) {
        const options = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality } };
        const some = Array.from({ length: count }, (_, i) => [
          all.subarray(1000 + 777 * i, 1000 + 777 * i + size),
          options,
        ]);
        time(`brotlis q${quality} ${size} ${kind} ${hash(some)}`, some, "zlib.brotliCompressSync(x[0], x[1])");
      }
  for (const size of [100, 4096, 100000])
    for (const level of [1, 6]) {
      const [data, options] = [texts.md.subarray(0, size), { library: "libdeflate", level } as const];
      time(`deflate gzip ${level} ${size}`, [[data, options]], "Bun.gzipSync(x[0], x[1])");
      time(`deflate gunzip ${level} ${size}`, [[Bun.gzipSync(data, options), options]], "Bun.gunzipSync(x[0], x[1])");
    }

  const ascii = Buffer.from(texts.rs.map(it => (it < 128 ? it : 63)));
  for (const size of [8, 40, 300, 4096, 65536]) {
    const some = Array.from({ length: size < 1000 ? 64 : 1 }, (_, i) => ascii.subarray(i * 777, i * 777 + size));
    const strings = some.map(it => it.toString("latin1"));
    const wide = strings.map(it => Buffer.from("漢" + it.slice(1), "utf16le").toString("utf16le"));
    const room = Buffer.alloc(3 * size);
    for (const it of ["crc32", "adler32", "xxHash32", "xxHash64", "xxHash3"])
      time(`hash ${it} ${size}`, some, `Bun.hash.${it}(x)`);
    for (const it of ["hex", "ascii", "latin1", "utf8"])
      time(`buffer toString ${it} ${size}`, some, `x.toString("${it}")`);
    time(
      `buffer from hex ${size}`,
      some.map(it => it.toString("hex")),
      `Buffer.from(x, "hex")`,
    );
    time(
      `buffer write utf8 ${size}`,
      strings.map(it => [room, it]),
      `x[0].write(x[1])`,
    );
    time(
      `buffer write latin1 of utf16 ${size}`,
      wide.map(it => [room, it]),
      `x[0].write(x[1], "latin1")`,
    );
    time(
      `buffer encodeInto ${size}`,
      strings.map(it => [room, it, new TextEncoder()]),
      `x[2].encodeInto(x[1], x[0])`,
    );
    for (const it of [16, 32, 64])
      time(`buffer swap${it} ${size}`, [Buffer.alloc(size & ~7, "abcdefgh")], `x.swap${it}()`);
    for (const it of ["indexOf", "lastIndexOf"]) {
      time(`search ${it} byte miss ${size}`, some, `x.${it}(0)`);
      time(`search ${it} newline ${size}`, some, `x.${it}(10)`);
      time(
        `search ${it} "fn " ${size}`,
        some.map(it => [it, Buffer.from("fn ")]),
        `x[0].${it}(x[1])`,
      );
      time(
        `search ${it} 12 miss ${size}`,
        some.map(it => [it, Buffer.from("self.lexer.q")]),
        `x[0].${it}(x[1])`,
      );
    }
    for (const it of ["stringWidth", "stripANSI", "escapeHTML"]) {
      time(`text ${it} ${size}`, strings, `Bun.${it}(x)`);
      time(`text ${it} utf16 ${size}`, wide, `Bun.${it}(x)`);
    }
    const colored = strings.map(it => Buffer.from(it.replaceAll("self", "\x1b[31mself\x1b[0m")).toString("latin1"));
    for (const it of ["stringWidth", "stripANSI"]) time(`text ${it} colored ${size}`, colored, `Bun.${it}(x)`);
  }

  const names = "src lib a node_modules test index.js utils .. components @types . README.md".split(" ");
  const paths = Array.from({ length: 512 }, (_, i) =>
    Buffer.from(
      "/p/" +
        Array.from({ length: 1 + (i % 6) }, (_, j) => names[(i * 7 + j * j * 5 + (i >> 3)) % names.length]).join("/"),
    ).toString(),
  );
  for (const it of ["normalize", "dirname", "basename", "extname", "resolve", "parse"])
    time(`path ${it}`, paths, `path.${it}(x)`);
  for (const it of ["relative", "join"])
    time(
      `path ${it}`,
      paths.map((a, i) => [a, paths[(i * 31 + 5) % 512]]),
      `path.${it}(x[0], x[1])`,
    );

  for (const file of [
    "src/js/node/querystring.ts",
    "src/js/node/fs.ts",
    "src/js/node/net.ts",
    "test/harness.ts",
    "scripts/runner.node.ts",
  ])
    for (const minifyWhitespace of [false, true])
      time(
        `parse ts ${file} ${minifyWhitespace}`,
        [[new Bun.Transpiler({ loader: "ts", minifyWhitespace }), read(file)]],
        "x[0].transformSync(x[1])",
      );
  for (const file of ["package.json", "test/package.json", "test/cli/install/migration/contoso-test/package-lock.json"])
    for (const it of ["JSONC", "JSON5", "YAML"])
      time(`parse ${it} ${file}`, [read(file).toString()], `Bun.${it}.parse(x)`);
  time("parse TOML", [read("Cargo.toml").toString()], "Bun.TOML.parse(x)");
  time("parse markdown", [texts.md.toString()], "Bun.markdown.html(x)");
  for (const count of [3, 100, 5000])
    for (const text of ["fish &amp; chips", "漢字 &amp; é"])
      time(
        `parse XML ${count} ${text.length}`,
        [`<r>${`<item id="7" kind='a'>\n  <name>${text}</name>\n</item>\n`.repeat(count)}</r>`],
        "Bun.XML.parse(x)",
      );
  const built = await Bun.build({
    entrypoints: [join(repo, "scripts/runner.node.ts")],
    target: "node",
    sourcemap: "external",
    packages: "external",
  });
  time("parse source map", [await built.outputs.find(it => it.kind === "sourcemap")!.json()], "new SourceMap(x)");

  const [photo, screenshot] = [read("docs/images/cat.jpg"), read("docs/images/ffi.png")];
  const drop = (it: Bun.Image) => it.resize(1, 1, { filter: "nearest" }).png({ compressionLevel: 0 });
  for (const [kind, file] of Object.entries({ photo, screenshot }))
    for (const width of [64, 640]) {
      const plain = await new Bun.Image(file).resize(width).png({ compressionLevel: 0 }).bytes();
      const formats = {
        "jpeg 80": (it: Bun.Image) => it.jpeg({ quality: 80 }),
        "jpeg progressive": (it: Bun.Image) => it.jpeg({ quality: 80, progressive: true }),
        "webp 20": (it: Bun.Image) => it.webp({ quality: 20 }),
        "webp 80": (it: Bun.Image) => it.webp({ quality: 80 }),
        "webp lossless": (it: Bun.Image) => it.webp({ lossless: true }),
        "png": (it: Bun.Image) => it.png(),
        "png palette": (it: Bun.Image) => it.png({ palette: true }),
      };
      for (const [format, to] of Object.entries(formats)) {
        const encoded = await to(new Bun.Image(plain)).bytes();
        await timeImage(`image to ${format} ${kind} ${width}`, () => to(new Bun.Image(plain)));
        await timeImage(`image from ${format} ${kind} ${width}`, () => drop(new Bun.Image(encoded)));
      }
    }
  const plain = await new Bun.Image(photo).resize(1000).png({ compressionLevel: 0 }).bytes();
  const changes = {
    "rotate 90": (it: Bun.Image) => it.rotate(90),
    "rotate 180": (it: Bun.Image) => it.rotate(180),
    "rotate 270": (it: Bun.Image) => it.rotate(270),
    "flip": (it: Bun.Image) => it.flip(),
    "flop": (it: Bun.Image) => it.flop(),
    "modulate": (it: Bun.Image) => it.modulate({ brightness: 1.1, saturation: 0.8 }),
    "shrink": (it: Bun.Image) => it.resize(300),
    "enlarge": (it: Bun.Image) => it.resize(1500),
  };
  for (const [name, change] of Object.entries(changes))
    await timeImage(`image ${name}`, () => change(new Bun.Image(plain)).jpeg({ quality: 10 }));
} else {
  console.log(cpus().length, "x", cpus()[0].model);
  for (const it of rest) console.log(Bun.spawnSync([it, "--revision"]).stdout.toString().trim());
  const best = new Map<string, number[]>();
  for (
    let turn = 0, start = Date.now();
    turn < 2 || turn % 2 || ((Date.now() - start) / turn) * (turn + 2) < 245e3;
    turn++
  ) {
    const { stdout, success } = Bun.spawnSync([rest[turn % 2], import.meta.path, "child", rest[0]], {
      stderr: "inherit",
    });
    if (!success) throw new Error(stdout.toString().slice(-300));
    for (const line of stdout.toString().trim().split(/\r?\n/)) {
      const [name, time] = line.split("\t");
      const row = best.get(name) ?? [Infinity, Infinity];
      row[turn % 2] = Math.min(row[turn % 2], Number(time));
      best.set(name, row);
    }
  }
  for (const [name, [a, b]] of best) console.log(`ROW\t${name}\t${a}\t${b}\t${(b / a).toFixed(3)}`);
}
