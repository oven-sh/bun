const nodejsBuiltinModules = [
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
];

function getModuleKeys(moduleName: string): string[] {
  const script = `import('${moduleName}').then(mod=>console.log(JSON.stringify(Object.keys(mod))))`;
  const nodeProc = Bun.spawnSync(["node", "-e", script], {
    stderr: "ignore",
  });
  const nodeKeys: string[] = JSON.parse(nodeProc.stdout.toString());
  return nodeKeys;
}
function getAllProperties(obj = {}) {
  const allKeys = new Set();
  do {
    Reflect.ownKeys(obj).forEach(key => allKeys.add(key));
  } while ((obj = Object.getPrototypeOf(obj)));
  return [...allKeys];
}

function getPrototypeKeys(moduleName: string, className: string): string[] {
  // const script = `import('${moduleName}').then(mod=>console.log(JSON.stringify(Object.keys(mod.${className}.prototype))))`;
  const script = `
  import("${moduleName}").then((mod) => {
  const lines = new Set();
  let obj = mod.${className}.prototype;
  do {
    Reflect.ownKeys(obj).forEach((key) => lines.add(key));
  } while ((obj = Object.getPrototypeOf(obj)));
  console.log("[", [...lines].map(k => \`"\${String(k)}"\`).join(","), "]");
});`.replace(/\n/g, "");
  // remove whitespace
  // .replace(/\s+/g, "");
  // console.log(script);
  const nodeProc = Bun.spawnSync(["node", "-e", script], {
    // stderr: "inherit",
    // stdout: "inherit",
  });
  // console.log(nodeProc.stdout.toString());
  const nodeKeys: string[] = JSON.parse(nodeProc.stdout.toString());

  return nodeKeys;
}
const SKIP: Record<string, boolean> = {
  "buffer.File": true,
  "process.abort": true,
  "process.exit": true,
  "process.kill": true,
  "process.reallyExit": true,
  "vm.Script": true,
  "zlib.deflate": true,
  "zlib.inflate": true,
  "zlib.unzip": true,
  "zlib.deflateRaw": true,
  "zlib.gunzip": true,
  "zlib.gzip": true,
  "zlib.inflateRaw": true,
  "console.assert": true,
  "console.count": true,
  // "fs.mkdtempSync": true,
  // "fs.read": true,
  // "fs.readv": true,
  // "fs.writev": true,
  // "fs.writeSync": true,
  // "fs.writeFileSync": true,
  // "fs.writeFile": true,
  // "fs.write": true,
  // "fs.writevSync": true,
  // "fs.watchFile": true,
  // "fs.watch": true,
  // "fs.utimesSync": true,
  // "fs.utimes": true,
  // "fs.unwatchFile": true,
  // "fs.unlinkSync": true,
  // "fs.unlink": true,
  // "fs.truncateSync": true,
  // "fs.truncate": true,
  // "fs.symlinkSync": true,
};

for (const moduleName of nodejsBuiltinModules) {
  const heading = `========   ${moduleName}   ========`;

  // print equals sign to match the length of heading
  console.log("\n\n" + "=".repeat(heading.length));
  console.log(heading);
  console.log("=".repeat(heading.length));
  const mod = await import(moduleName);
  const bunKeys: string[] = Object.keys(mod);
  const nodeKeys = getModuleKeys(moduleName);

  // print top-level elements that are missing
  // const missingKeys = nodeKeys
  //   .filter((key) => !bunKeys.includes(key))
  //   .filter((k) => !k.startsWith("_"));
  // const notMissing = nodeKeys.filter((key) => bunKeys.includes(key));

  // if (missingKeys.length === 0) {
  //   console.log(`Fully implemented.`);
  // } else {
  //   console.log(`Missing ${missingKeys.map((k) => `\`${k}\``).join(" ")}`);
  // }
  console.log();

  // check for prototype compatibility
  let missing = false;
  for (const k of nodeKeys) {
    if (k.startsWith("_")) continue;
    if (!bunKeys.includes(k)) {
      missing = true;
      console.log(`  [${moduleName}.${k}] Not implemented.`);
      continue;
    }
    if (mod[k] && typeof mod[k] === "function") {
      if (!!mod[k].prototype) {
        const className = `${moduleName}.${k}`;

        const bunProtoKeys = getAllProperties(mod[k].prototype);
        // console.log(mod[k].prototype);
        // getAllProperties;
        // for (const l in mod[k].prototype) {
        //   bunProtoKeys.push(l);
        // }

        const nodeProtoKeys = getPrototypeKeys(moduleName, k);
        // console.log("nodeProtoKeys", nodeProtoKeys);
        // console.log("bunProtoKeys", bunProtoKeys);

        // console.log("nodeProtoKeys", nodeProtoKeys);
        // console.log("bunProtoKeys", bunProtoKeys);
        const missingProtoKeys = nodeProtoKeys.filter(key => !bunProtoKeys.includes(key));
        // const notMissingProtoKeys = nodeProtoKeys.filter((key) =>
        //   bunProtoKeys.includes(key)
        // );
        if (missingProtoKeys.length === 0) {
          console.log(`  [${className}] Fully implemented.`);
        } else {
          missing = true;
          console.log(
            `  [${className}] Missing ${missingProtoKeys
              .filter(k => !k.startsWith("_"))
              .map(k => `\`${k}\``)
              .join(" ")}`,
          );
        }
      } else {
        if (moduleName === "console") continue;
        if (moduleName === "fs") continue;
        if (SKIP[`${moduleName}.${k}`]) continue;
        try {
          // console.log(`trying ${moduleName}.${k}...`);
          await mod[k]();
          await Bun.sleep(1);
        } catch (err: any) {
          if ((err?.message as string).includes("not yet implemented")) {
            missing = true;
            console.log(`  [${moduleName}.${k}] Not implemented.`);
          }
        }
      }
    }
  }

  if (!missing) {
    console.log(`[${moduleName}] Fully implemented.`);
  }
}

console.log("\n\n================\nDONE.");
process.exit();
