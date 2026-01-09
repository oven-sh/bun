(function () {
  function normalizeInternalLinks() {
    const selectors = [
      'a[href*="bun.com/docs/installation"]',
      'a[href="https://bun.com/reference"]',
      'a[href="https://bun.com/blog"]',
    ];

    selectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        if (element.hasAttribute("target")) {
          element.removeAttribute("target");
          // Also remove rel="noreferrer" if present, typically paired with target="_blank"
          if (element.getAttribute("rel") === "noreferrer") {
            element.removeAttribute("rel");
          }
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", normalizeInternalLinks);
  } else {
    normalizeInternalLinks();
  }

  const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (mutation.type === "childList" || mutation.type === "attributes") {
        normalizeInternalLinks();
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["target", "href"],
  });
})();
