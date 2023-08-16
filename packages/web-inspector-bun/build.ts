import { build } from "esbuild";
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { join } from "path";
const basePath = join(import.meta.dir, "../../src/bun.js/WebKit/Source/WebInspectorUI/UserInterface");
const htmlPath = join(basePath, "Main.html");
const backendCommands = join(
  import.meta.dir,
  "../../src/bun.js/WebKit/WebKitBuild/Release/JavaScriptCore/DerivedSources/inspector/InspectorBackendCommands.js",
);
const scriptsToBundle = [];
const stylesToBundle = [];
const jsReplacementId = crypto.randomUUID() + ".js";
const cssReplacementId = crypto.randomUUID() + ".css";
const html = new HTMLRewriter()
  .on("script", {
    element(element) {
      const src = element.getAttribute("src");
      if (src && !src?.includes("External") && !src?.includes("WebKitAdditions")) {
        if (scriptsToBundle.length === 0) {
          element.replace("<script>var WI = {};\n</script>", { html: true });
        } else {
          element.remove();
        }

        scriptsToBundle.push(src);
      }
    },
  })
  .on("script:not([src])", {
    element(element) {
      element.remove();
    },
  })
  .on("head", {
    element(element) {
      element.prepend(` <base href="/inspect/" /> `, { html: true });

      element.append(
        `
        <script src="${jsReplacementId}"></script>

        <script>
            WI.sharedApp = new WI.AppController;
            WI.sharedApp.initialize();
        </script>`,
        { html: true },
      );
    },
  })
  //   .on("link[rel=stylesheet]", {
  //     element(element) {
  //       const href = element.getAttribute("href");
  //       if (href && !href?.includes("External") && !href?.includes("WebKitAdditions")) {
  //         element.remove();
  //         stylesToBundle.push(href);
  //       }
  //     },
  //   })
  .transform(new Response(Bun.file(htmlPath)));
let htmlText = await html.text();
rmSync(join(import.meta.dir, "out"), { recursive: true, force: true });
mkdirSync(join(import.meta.dir, "out", "inspect", "Protocol"), { recursive: true });

const javascript = scriptsToBundle.map(a => `import '${join(basePath, a)}';`).join("\n") + "\n";
// const css = stylesToBundle.map(a => `@import "${join(basePath, a)}";`).join("\n") + "\n";
await Bun.write(join(import.meta.dir, "out/manifest.js"), javascript);
// await Bun.write(join(import.meta.dir, "manifest.css"), css);
const jsBundle = await Bun.build({
  entrypoints: [join(import.meta.dir, "out/manifest.js")],
  outdir: "out",
  minify: true,
});
const jsFilename = "manifest-" + jsBundle.outputs[0].hash + ".js";
// const cssBundle = await build({
//   bundle: true,
//   minify: true,
//   write: false,
//   entryPoints: [join(import.meta.dir, "manifest.css")],
//   outdir: "out",
//   loader: {
//     ".css": "css",
//     ".svg": "dataurl",
//   },
//   external: ["*.png"],
//   plugins: [
//     {
//       name: "css",
//       setup(build) {
//         build.onResolve({ filter: new RegExp("/Images/Warning.svg") }, args => ({
//           path: join(basePath, "Images/Warning.svg"),
//         }));
//       },
//     },
//   ],
// });

// const cssFilename = "manifest-" + cssBundle.outputFiles[0].hash.replaceAll("/", "_") + ".css";
htmlText = htmlText.replace(jsReplacementId, "/inspect/" + jsFilename);
// htmlText = htmlText.replace(cssReplacementId, cssFilename);
await Bun.write(join(import.meta.dir, "out", "inspect", jsFilename), jsBundle.outputs[0]);
// await Bun.write(join(import.meta.dir, "out", cssFilename), cssBundle.outputFiles[0].text);
await Bun.write(join(import.meta.dir, "out", "inspect", "index.html"), htmlText);
await Bun.write(join(import.meta.dir, "out", "index.html"), htmlText);
await Bun.write(
  join(import.meta.dir, "out", "inspect", "Protocol", "InspectorBackendCommands.js"),
  Bun.file(backendCommands),
);

function recursiveCopy(src, dest) {
  readdirSync(src).forEach(file => {
    const srcPath = join(src, file);
    const destPath = join(dest, file);
    if (statSync(srcPath).isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      recursiveCopy(srcPath, destPath);
    } else {
      rmSync(destPath, { force: true });
      copyFileSync(srcPath, destPath);
    }
  });
}

recursiveCopy(basePath, join(import.meta.dir, "out/inspect"));
