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
const registeredLinkTags = new Map<HTMLLinkElement, string>();

interface CSS {
  sheet: CSSStyleSheet | null;
  link: HTMLLinkElement | null;
  active: boolean;
}

function validateCssId(id: string) {
  if (!/^[a-f0-9]{16}$/.test(id)) {
    throw new Error(`Invalid CSS id: ${id}`);
  }
}

function deactivateCss(css: CSS) {
  if (css.active) {
    const { sheet, link } = css;
    css.active = false;
    if (sheet) {
      sheet.disabled = true;
    } else if (link) {
      const linkSheet = link.sheet;
      if (linkSheet) linkSheet.disabled = true;
    }
  }
}

function activateCss(css: CSS) {
  if (!css.active) {
    css.active = true;
    if (css.sheet) {
      css.sheet.disabled = false;
    } else if (css.link) {
      const linkSheet = css.link.sheet;
      if (linkSheet) linkSheet.disabled = false;
    }
  }
}

// A mutation observer detects when the framework does client-side routing.
const headObserver = new MutationObserver(list => {
  for (const mutation of list) {
    if (mutation.type === "childList") {
      // This allows frameworks to add and remove link tags. Removing a link tag
      // that Bun had reloaded needs to disable the wrapped sheet. The wrapper
      // is kept around in case the framework re-adds the link tag.
      let i = 0;
      let len = mutation.removedNodes.length;
      while (i < len) {
        const node = mutation.removedNodes[i];
        const id = registeredLinkTags.get(node as HTMLLinkElement);
        if (id) {
          const existingSheet = cssStore.get(id);
          if (existingSheet) {
            deactivateCss(existingSheet);
          }
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
      // This allows frameworks to set the `disabled` attribute on the link tag
      const target = mutation.target as HTMLLinkElement;
      if (target.tagName === "LINK" && target.rel === "stylesheet") {
        const id = registeredLinkTags.get(target);
        if (id) {
          const existing = cssStore.get(id);
          if (existing) {
            const disabled = target.disabled;
            if (disabled) {
              deactivateCss(existing);
            } else {
              activateCss(existing);
            }
          }
        }
      }
    }
  }
});

function maybeAddCssLink(link: HTMLLinkElement) {
  const pathname = new URL(link.href).pathname;
  if (pathname.startsWith("/_bun/asset/")) {
    const id = pathname.slice("/_bun/asset/".length).slice(0, 16);
    if (!/^[a-f0-9]{16}$/.test(id)) {
      return;
    }
    const existing = cssStore.get(id);
    if (existing) {
      const { sheet } = existing;
      if (sheet) {
        // The HMR runtime has a managed sheet already.
        sheet.disabled = false;
        const linkSheet = link.sheet;
        if (linkSheet) linkSheet.disabled = true;
      }
      existing.link = link;
    } else {
      cssStore.set(id, {
        sheet: null,
        link,
        active: true,
      });
    }
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
    if (IS_BUN_DEVELOPMENT) validateCssId(css);
    const existing = cssStore.get(css);
    removedCssKeys.delete(css);
    if (existing) {
      activateCss(existing);
    } else {
      // This will be populated shortly by a call to `editCssContent`
      cssStore.set(css, {
        sheet: null,
        link: null,
        active: true,
      });
    }
  }
  for (const css of removedCssKeys) {
    const entry = cssStore.get(css);
    if (entry) {
      deactivateCss(entry);
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
    return false;
  }
  sheet!.replace(newContent);
  return !sheet!.disabled;
}
