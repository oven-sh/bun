// Add Event Listener to `Copy` button
// Capture copied text
// remove "# <text>"
// update the clipbard with cleaned text
(function () {
  function cleanCode(text) {
    return text
      .split("\n")
      .map(line => line.replace(/\s+#.*$/, "").trimEnd())
      .join("\n")
      .trim();
  }

  function attachCopyListeners() {
    document.querySelectorAll('button[class*="copy"], [aria-label*="copy"], [title*="copy"]').forEach(btn => {
      if (btn._bunCleanCopy) return; // avoid duplicate listeners
      btn._bunCleanCopy = true;

      btn.addEventListener(
        "click",
        e => {
          const pre = btn.closest("pre") || btn.closest('div[class*="code"]');
          if (!pre) return;

          const codeBlockEle = pre.querySelectorAll('div[data-component-part="code-block-root"]');
          if (codeBlockEle.length === 1) {
            const codeBlockElement = codeBlockEle[0];
            const cleanedText = cleanCode(codeBlockElement.textContent);
            e.preventDefault();
            e.stopImmediatePropagation();

            navigator.clipboard.writeText(cleanedText);
          }
        },
        true,
      ); // capture phase to run before the site's own handler
    });
  }

  // Run on load and watch for dynamically added code blocks
  attachCopyListeners();
  new MutationObserver(attachCopyListeners).observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
