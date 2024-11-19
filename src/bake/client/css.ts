// CSS hot reloading is implemented a bit weirdly. A lot of opinions on how CSS
// is managed is put in the hands of the framework implementation, but it is
// assumed that some basic things always hold true:
//
// - SSR injects <link> elements with the URLs that Bun provided
// - CSR will remove or append new <link> elements
// - These link elements are direct children of <head>
// - The URL bar contains the current route reflected by the UI
//
// With this, production mode is fully implemented in the framework, and
// DevServer can hot-reload these files with some clever observation.

/**
 * Map between CSS identifier and it's style tag.
 * If a file is not present in this map, it might exist as a link tag in the HTML.
 */
const cssStore = new Map<string, CSS>();
const active = new Set<string>();

interface CSS {
  sheet: CSSStyleSheet | null;
  link: HTMLLinkElement;
}

const mo = new MutationObserver((mutation) => {
  // 
});
mo.observe(document.head, { childList: true });

document.querySelectorAll<HTMLLinkElement>("head > link[rel=stylesheet]").forEach((link) => {
  if (link.href.startsWith("/_bun/css/")) {
    const id = link.href.slice("/_bun/css/".length, link.href.length - ".css".length);
    cssStore.set(id, {
      sheet: null,
      link,
    });
  }
});

function reloadCss(id: string, newContent: string) {
  // console.log(`[Bun] Reloading CSS: ${id}`);

  // // TODO: can any of the following operations throw?
  // let sheet = cssStore.get(id);
  // if (!sheet) {
  //   sheet = new CSSStyleSheet();
  //   sheet.replace(newContent);
  //   document.adoptedStyleSheets.push(sheet);
  //   cssStore.set(id, sheet);

  //   // Disable the link tag if it exists
  //   const link = document.querySelector<HTMLLinkElement>(`link[href="/_bun/css/${id}.css"]`);
  //   let linkSheet;
  //   if (link && (linkSheet = link.sheet))
  //     linkSheet.disabled = true;
  //   return;
  // }

  // sheet.replace(newContent);
}