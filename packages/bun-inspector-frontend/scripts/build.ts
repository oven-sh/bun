import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";

const projectPath = resolve(import.meta.dir, "..", "..", "..");
const uiPath = join(projectPath, "src", "bun.js", "WebKit", "Source", "WebInspectorUI", "UserInterface");
const indexPath = join(uiPath, "Main.html");
const commandPath = join(
  projectPath,
  "src",
  "bun.js",
  "WebKit",
  "WebKitBuild",
  "Release",
  "JavaScriptCore",
  "DerivedSources",
  "inspector",
  "InspectorBackendCommands.js",
);

if (!existsSync(indexPath)) {
  console.error("Did you run `make jsc` first?");
  process.exit(1);
}

const randomId = `${crypto.randomUUID()}.js`;
const scripts: string[] = [];

const html = new HTMLRewriter()
  .on("script", {
    element(element: HTMLRewriterTypes.Element) {
      const src = element.getAttribute("src");
      if (src && !src?.includes("External") && !src?.includes("WebKitAdditions") && !src.includes("DOMUtilities.js")) {
        if (scripts.length) {
          element.remove();
        } else {
          element.replace("<script>var WI = {};\n</script>", { html: true });
        }
        scripts.push(src);
      }
    },
  })
  .on("script:not([src])", {
    element(element: HTMLRewriterTypes.Element) {
      element.remove();
    },
  })
  .on("head", {
    element(element: HTMLRewriterTypes.Element) {
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
        <script src="${randomId}"></script>

        <script type="text/javascript">
            WI.sharedApp = new WI.AppController;
            WI.sharedApp.initialize();
        </script>`,
        { html: true },
      );
    },
  })
  .transform(new Response(readFileSync(indexPath)));

const indexHtml = await html.text();
const indexJs = `${scripts.map(path => `import '${join(uiPath, path)}';`).join("\n")}\n`;

const distPath = resolve(import.meta.dir, "..", "dist");
const manifestPath = join(distPath, "manifest.js");
const additionsPath = join(distPath, "WebKitAdditions", "WebInspectorUI");

rmSync(distPath, { recursive: true, force: true });
mkdirSync(distPath, { recursive: true });
writeFileSync(manifestPath, indexJs);
mkdirSync(additionsPath, { recursive: true });
writeFileSync(join(additionsPath, "WebInspectorUIAdditions.js"), "");
writeFileSync(join(additionsPath, "WebInspectorUIAdditions.css"), "");

const { outputs } = await Bun.build({
  entrypoints: [manifestPath],
  outdir: distPath,
  minify: true,
});
const [output] = outputs;

const indexName = `manifest-${output.hash}.js`;
writeFileSync(join(distPath, indexName), await output.arrayBuffer());
writeFileSync(join(distPath, "index.html"), indexHtml.replace(randomId, indexName));

mkdirSync(join(distPath, "Protocol"), { recursive: true });
cpSync(commandPath, join(distPath, "Protocol", "InspectorBackendCommands.js"));
cpSync(uiPath, distPath, { recursive: true });
