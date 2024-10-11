import { css } from "../macros" with { type: "macro" };

if (side !== 'client') throw new Error('Not client side!');

// Create a root element to contain all our our DOM nodes.
var root!: HTMLElement;
function mount() {
  const wrap = document.createElement("bun-hmr");
  wrap.setAttribute(
    "style",
    "position:absolute;display:block;top:0;left:0;width:100%;height:100%;background:transparent",
  );
  const shadow = wrap.attachShadow({ mode: "open" });

  const sheet = new CSSStyleSheet();
  sheet.replace(css("client/overlay.css", IS_BUN_DEVELOPMENT));
  shadow.adoptedStyleSheets = [sheet];

  root = document.createElement("main");
  shadow.appendChild(root);
  document.body.appendChild(wrap);
};

export function showErrorOverlay(e) {
  mount();
  console.error(e);
  root.innerHTML = `<div class='error'><h1>Client-side Runtime Error</h1><pre><code>${e?.message ? `${e?.name ?? e?.constructor?.name ?? "Error"}: ${e.message}\n` : JSON.stringify(e)}${e?.message ? e?.stack : ""}</code></pre><button class='dismiss'>x</button></div>`;
  root.querySelector(".dismiss")!.addEventListener("click", () => {
    root.innerHTML = "";
  });
}
