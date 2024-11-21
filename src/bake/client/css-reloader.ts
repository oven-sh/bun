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
//
// The approach is to attach CSSStyleSheet objects to the page, which
// the runtime can update at will. Then, a MutationObserver is used to
// allow the framework to change the <link> tags as a part of its own
// client-side navigation.

const cssStore = new Map<string, CSS>();
const active = new Set<string>();
const registeredLinkTags = new Map<HTMLLinkElement, string>();

interface CSS {
  sheet: CSSStyleSheet | null;
  link: HTMLLinkElement | null;
}

// A mutation observer detects when the framework does client-side routing.
const headObserver = new MutationObserver(list => {
  for (const mutation of list) {
    if (mutation.type === "childList") {
      let i = 0;
      let len = mutation.removedNodes.length;
      while (i < len) {
        const node = mutation.removedNodes[i];
        const id = registeredLinkTags.get(node as HTMLLinkElement);
        if (id) {
          const existingSheet = cssStore.get(id)?.sheet;
          if (existingSheet) {
            const adoptedStyleSheets = document.adoptedStyleSheets;
            const index = adoptedStyleSheets.indexOf(existingSheet);
            if (index !== -1) {
              adoptedStyleSheets.splice(index, 1);
            }
          }
          active.delete(id);
          registeredLinkTags.delete(node as HTMLLinkElement);
        }
        i++;
      }
      i = 0;
      len = mutation.addedNodes.length;
      while (i < len) {
        const node = mutation.addedNodes[i];
        if (node instanceof HTMLLinkElement) {
          maybeAddCssLink(node);
        }
        i++;
      }
    } else if (mutation.type === "attributes") {
      const target = mutation.target as HTMLLinkElement;
      if (target.tagName === "LINK" && target.rel === "stylesheet") {
        const id = registeredLinkTags.get(target);
        if (id) {
          const existingSheet = cssStore.get(id)?.sheet;

          const disabled = target.disabled;
          if (existingSheet) {
            existingSheet.disabled = disabled;
          }

          if (disabled) {
            active.delete(id);
          } else {
            active.add(id);
          }
        }
      }
    }
  }
});

function maybeAddCssLink(link: HTMLLinkElement) {
  const pathname = new URL(link.href).pathname;
  if (pathname.startsWith("/_bun/css/")) {
    const id = pathname.slice("/_bun/css/".length).slice(0, 16);
    const existing = cssStore.get(id);
    if (existing) {
      const { sheet } = existing;
      if (sheet) {
        // The HMR runtime has a managed sheet.
        sheet.disabled = false;
        const linkSheet = link.sheet;
        if (linkSheet) linkSheet.disabled = true;
      }
      existing.link = link;
    } else {
      cssStore.set(id, {
        sheet: null,
        link,
      });
    }
    active.add(id);
    registeredLinkTags.set(link, id);
  }
}

headObserver.observe(document.head, {
  childList: true,
  // TODO: consider using a separate observer for attributes, this can avoid subtree
  subtree: true,
  attributes: true,
  attributeFilter: ["disabled"],
});
document.querySelectorAll<HTMLLinkElement>("head>link[rel=stylesheet]").forEach(maybeAddCssLink);

export function editCssArray(array: string[]) {
  const removedCssKeys = new Set(cssStore.keys());
  for (const css of array) {
    const existing = cssStore.get(css);
    if (existing) {
      removedCssKeys.delete(css);
      const { sheet, link } = existing;
      if (sheet) {
        document.adoptedStyleSheets.push(sheet);
      } else if (link) {
        const linkSheet = link.sheet;
        if (linkSheet) linkSheet.disabled = false;
      }
    } else {
      // This will be populated shortly by a call to `editCssContent`
      cssStore.set(css, {
        sheet: null,
        link: null,
      });
    }
  }
  for (const css of removedCssKeys) {
    const entry = cssStore.get(css);
    if (entry) {
      if (entry.sheet) {
        const index = document.adoptedStyleSheets.indexOf(entry.sheet);
        if (index !== -1) {
          document.adoptedStyleSheets.splice(index, 1);
        }
      }
      if (entry.link) {
        // Disable it but not remove it so a framework isn't confused
        // if it is performing its own DOM-diffing logic.
        const linkSheet = entry.link?.sheet;
        if (linkSheet) linkSheet.disabled = true;
      }
    }
  }
}

export function editCssContent(id: string, newContent: string) {
  let entry = cssStore.get(id);
  if (!entry) return;
  let sheet = entry.sheet;
  if (!entry.sheet) {
    sheet = entry.sheet = new CSSStyleSheet();
    sheet.replace(newContent);
    document.adoptedStyleSheets.push(sheet);

    // Disable the link tag if it exists
    const linkSheet = entry.link?.sheet;
    if (linkSheet) linkSheet.disabled = true;
    return;
  }
  sheet!.replace(newContent);
}
