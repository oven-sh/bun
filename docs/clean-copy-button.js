// Add Event Listener to `Copy` button
// Capture copied text
// remove "# <text>"
// update the clipboard with cleaned text
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
          // prefer the visible/active tab; fall back to first element
          const codeBlockElement =
            Array.from(codeBlockEle).find(el => !el.hidden && el.offsetParent !== null) ?? codeBlockEle[0];
          if (codeBlockElement) {
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
