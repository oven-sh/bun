import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { join } from "path";

try {
  const basePath = join(import.meta.dir, "../../../src/bun.js/WebKit/Source/WebInspectorUI/UserInterface");
  const htmlPath = join(basePath, "Main.html");
  const backendCommands = join(
    import.meta.dir,
    "../../../src/bun.js/WebKit/WebKitBuild/Release/JavaScriptCore/DerivedSources/inspector/InspectorBackendCommands.js",
  );
  const scriptsToBundle = [];
  const stylesToBundle = [];
  const jsReplacementId = crypto.randomUUID() + ".js";
  const cssReplacementId = crypto.randomUUID() + ".css";
  const html = new HTMLRewriter()
    .on("script", {
      element(element) {
        const src = element.getAttribute("src");
        if (
          src &&
          !src?.includes("External") &&
          !src?.includes("WebKitAdditions") &&
          !src.includes("DOMUtilities.js")
        ) {
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
        element.prepend(
          `
          <script type="text/javascript">
        if (!Element.prototype.scrollIntoViewIfNeeded) {
          Element.prototype.scrollIntoViewIfNeeded = function (centerIfNeeded) {
            centerIfNeeded = arguments.length === 0 ? true : !!centerIfNeeded;
        
            var parent = this.parentNode,
                parentComputedStyle = window.getComputedStyle(parent, null),
                parentBorderTopWidth = parseInt(parentComputedStyle.getPropertyValue('border-top-width')),
                parentBorderLeftWidth = parseInt(parentComputedStyle.getPropertyValue('border-left-width')),
                overTop = this.offsetTop - parent.offsetTop < parent.scrollTop,
                overBottom = (this.offsetTop - parent.offsetTop + this.clientHeight - parentBorderTopWidth) > (parent.scrollTop + parent.clientHeight),
                overLeft = this.offsetLeft - parent.offsetLeft < parent.scrollLeft,
                overRight = (this.offsetLeft - parent.offsetLeft + this.clientWidth - parentBorderLeftWidth) > (parent.scrollLeft + parent.clientWidth),
                alignWithTop = overTop && !overBottom;
        
            if ((overTop || overBottom) && centerIfNeeded) {
              parent.scrollTop = this.offsetTop - parent.offsetTop - parent.clientHeight / 2 - parentBorderTopWidth + this.clientHeight / 2;
            }
        
            if ((overLeft || overRight) && centerIfNeeded) {
              parent.scrollLeft = this.offsetLeft - parent.offsetLeft - parent.clientWidth / 2 - parentBorderLeftWidth + this.clientWidth / 2;
            }
        
            if ((overTop || overBottom || overLeft || overRight) && !centerIfNeeded) {
              this.scrollIntoView(alignWithTop);
            }
          };
        }
        </script>
        <base href="/" /> `,
          { html: true },
        );

        element.append(
          `
        <style>
            body {
                --undocked-title-area-height: 0px !important;
            }
        </style>
        <script src="${jsReplacementId}"></script>

        <script type="text/javascript">
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
  mkdirSync(join(import.meta.dir, "out", "Protocol"), { recursive: true });

  const javascript = scriptsToBundle.map(a => `import '${join(basePath, a)}';`).join("\n") + "\n";
  // const css = stylesToBundle.map(a => `@import "${join(basePath, a)}";`).join("\n") + "\n";
  await Bun.write(join(import.meta.dir, "out/manifest.js"), javascript);
  mkdirSync("out/WebKitAdditions/WebInspectorUI/", { recursive: true });
  await Bun.write(join(import.meta.dir, "out/WebKitAdditions/WebInspectorUI/WebInspectorUIAdditions.js"), "");
  await Bun.write(join(import.meta.dir, "out/WebKitAdditions/WebInspectorUI/WebInspectorUIAdditions.css"), "");
  // await Bun.write(join(import.meta.dir, "manifest.css"), css);
  const jsBundle = await Bun.build({
    entrypoints: [join(import.meta.dir, "out/manifest.js")],
    outdir: "out",
    minify: true,
    throw: true,
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
  htmlText = htmlText.replace(jsReplacementId, jsFilename);
  // htmlText = htmlText.replace(cssReplacementId, cssFilename);
  await Bun.write(join(import.meta.dir, "out", jsFilename), jsBundle.outputs[0]);
  // await Bun.write(join(import.meta.dir, "out", cssFilename), cssBundle.outputFiles[0].text);
  await Bun.write(join(import.meta.dir, "out", "index.html"), htmlText);
  await Bun.write(join(import.meta.dir, "out", "index.html"), htmlText);
  await Bun.write(join(import.meta.dir, "out", "Protocol", "InspectorBackendCommands.js"), Bun.file(backendCommands));

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

  recursiveCopy(basePath, join(import.meta.dir, "out"));
} catch (e) {
  console.error("Failed to build. Please make sure you've ran `make jsc` locally.");
  throw e;
}
