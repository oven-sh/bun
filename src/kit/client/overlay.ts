import { css } from '../macros' with { type: 'macro' };

// Create a root element to contain all our our DOM nodes.
var root!: HTMLElement;
if (mode === 'client') {
  const wrap = document.createElement('bun-hmr');
  wrap.setAttribute('style', 'position:absolute;display:block;top:0;left:0;width:100%;height:100%;background:transparent');
  const shadow = wrap.attachShadow({ mode: 'open' });

  const sheet = new CSSStyleSheet();
  sheet.replace(css('client/overlay.css', IS_BUN_DEVELOPMENT));
  shadow.adoptedStyleSheets = [ sheet ];

  root = document.createElement('main');
  shadow.appendChild(root);
  document.body.appendChild(wrap);
}

export function showErrorOverlay(e) {
  console.error(e);  
  root.innerHTML = `<div class='error'><h1>oh no, a client side error happened:</h1><pre><code>${e?.message ? `${e?.name ?? (e?.constructor?.name) ?? 'Error'}: ${e.message}\n` : JSON.stringify(e)}${e?.message ? e?.stack : ''}</code></pre></div>`;
}
