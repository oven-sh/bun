(function () {
  function normalizeInternalLinks() {
    const selectors = [
      'a[href^="https://bun.com/docs/installation"]',
      'a[href^="https://bun.com/reference"]',
      'a[href^="https://bun.com/blog"]',
    ];

    selectors.forEach((selector) => {
      const elements = document.querySelectorAll(selector);

      // Early return to avoid useless looping
      if (!elements.length) return;

      elements.forEach((element) => {
        let removed = false;

        // Remove target="_blank"
        if (element.hasAttribute("target")) {
          element.removeAttribute("target");
          removed = true;
        }

        // Remove rel="noreferrer" when paired with _blank
        if (element.getAttribute("rel") === "noreferrer") {
          element.removeAttribute("rel");
          removed = true;
        }

        // Only log in development AND only when something actually changed
        if (removed && location.hostname === "localhost") {
          console.log(
            `Removed target-related attributes from: ${
              element.textContent || element.innerHTML.substring(0, 50)
            }`
          );
        }
      });
    });
  }

  // Run on page load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", normalizeInternalLinks);
  } else {
    normalizeInternalLinks();
  }

  // Observe DOM changes
  const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      // Only run when target/href changes, not every attribute
      if (mutation.type === "attributes") {
        if (!["target", "href", "rel"].includes(mutation.attributeName)) return;
      }

      normalizeInternalLinks();
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["target", "href", "rel"],
  });
})();
