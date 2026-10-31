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
  /** True while `loadCssText` requests the text. */
  loading: boolean;
}

/**
 * The only writer of `disabled`. A stylesheet is on while its entry is active.
 * A sheet that the runtime manages takes the place of the link tag's sheet.
 */
function apply(css: CSS) {
  const { sheet, link } = css;
  const linkSheet = link && link.sheet;
  if (sheet) {
    sheet.disabled = !css.active;
    if (linkSheet) linkSheet.disabled = true;
  } else if (linkSheet) {
    linkSheet.disabled = !css.active;
  }
  // A link tag has no sheet until it has loaded, and it loads again after its
  // `disabled` attribute is removed.
  if (link && !linkSheet) link.addEventListener("load", onLinkLoad);
}

function onLinkLoad(this: HTMLLinkElement) {
  const css = cssStore.get(registeredLinkTags.get(this)!);
  if (css && css.link === this) apply(css);
}

/** True if a link tag in the document gives the stylesheet its text. */
function hasLinkInUse({ link }: CSS) {
  return link !== null && link.isConnected && !link.disabled;
}

/** True if the page applies the stylesheet and nothing gives it the text. */
function lacksText(css: CSS) {
  return css.active && !css.sheet && !css.loading && !hasLinkInUse(css);
}

function validateCssId(id: string) {
  if (!/^[a-f0-9]{16}$/.test(id)) {
    throw new Error(`Invalid CSS id: ${id}`);
  }
}

function deactivateCss(css: CSS) {
  if (css.active) {
    css.active = false;
    apply(css);
  }
}

function activateCss(css: CSS) {
  if (!css.active) {
    css.active = true;
    apply(css);
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
          // Another link tag of the stylesheet can be in the document: a
          // framework appends its own before it removes the one from SSR.
          if (existingSheet && existingSheet.link === node) {
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
            // Not only when `active` changes: a link tag that was switched
            // off and on again has a new sheet.
            existing.active = !target.disabled;
            apply(existing);
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
    registeredLinkTags.set(link, id);
    const existing = cssStore.get(id);
    if (existing) {
      existing.link = link;
      existing.active = !link.disabled;
      apply(existing);
    } else {
      // Not applied: the sheet of a link tag that is new to the page stays as the browser made it.
      cssStore.set(id, { sheet: null, link, active: !link.disabled, loading: false });
    }
  }
}

headObserver.observe(document.head, {
  childList: true,
  // TODO: consider using a separate observer for attributes, this can avoid subtree
  subtree: true,
  attributes: true,
  attributeFilter: ["disabled"],
});
// Not only in <head>: the dev server writes the link tags into <body> when
// the HTML file has no `</head>`.
document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet][href]").forEach(maybeAddCssLink);

/**
 * Takes every stylesheet of the page. Returns those that the page has no text
 * for, or `undefined` when it has the text of each. A hot update carries the
 * text only of the stylesheets that it bundled: `editCssContent` takes that,
 * and `loadCssText` requests the rest.
 */
export function editCssArray(array: string[]) {
  const removedCssKeys = new Set(cssStore.keys());
  let withoutText: string[] | undefined;
  for (const css of array) {
    if (IS_BUN_DEVELOPMENT) validateCssId(css);
    let entry = cssStore.get(css);
    removedCssKeys.delete(css);
    if (entry) {
      activateCss(entry);
    } else {
      entry = { sheet: null, link: null, active: true, loading: false };
      cssStore.set(css, entry);
    }
    if (lacksText(entry)) (withoutText ??= []).push(css);
  }
  for (const css of removedCssKeys) {
    const entry = cssStore.get(css);
    if (entry) {
      deactivateCss(entry);
    }
  }
  return withoutText;
}

/**
 * Requests the text of each of `ids` that still has none, from the URL that a
 * page load links. Calls `done` once, when every request has ended and the
 * text is in place. Returns false, and never calls `done`, when it requests
 * nothing.
 */
export function loadCssText(ids: string[], done: () => void) {
  const requested: string[] = [];
  const requests: Promise<string | null>[] = [];
  for (const id of ids) {
    const css = cssStore.get(id)!;
    // The update itself can have had the text.
    if (!lacksText(css)) continue;
    css.loading = true;
    requested.push(id);
    requests.push(
      // `no-store`: the URL stays the same when the stylesheet changes.
      fetch("/_bun/asset/" + id + ".css", { cache: "no-store" })
        .then(response => (response.ok ? response.text() : null))
        // The page unloads, or the server is gone and the socket reports that.
        .catch(() => null),
    );
  }
  if (requests.length === 0) return false;
  Promise.all(requests)
    .then(texts => {
      for (const id of requested) cssStore.get(id)!.loading = false;
      // In the order of the list, which is the order of the link tags of a page load.
      const replaced: unknown[] = [];
      for (let i = 0; i < texts.length; i++) {
        const id = requested[i];
        const css = cssStore.get(id)!;
        const text = texts[i];
        // A later update or a link tag can have brought the text in the meantime.
        if (text !== null && !css.sheet && !hasLinkInUse(css)) replaced.push(editCssContent(id, text));
      }
      return Promise.allSettled(replaced);
    })
    .finally(done);
  return true;
}

/** Returns what `CSSStyleSheet.replace` returned: a promise that settles when the text is in place. */
export function editCssContent(id: string, newContent: string) {
  let entry = cssStore.get(id);
  if (!entry) return;
  let sheet = entry.sheet;
  if (!sheet) {
    sheet = entry.sheet = new CSSStyleSheet();
    const replaced = sheet.replace(newContent);
    document.adoptedStyleSheets.push(sheet);
    apply(entry);
    return replaced;
  }
  return sheet.replace(newContent);
}
