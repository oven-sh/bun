(function () {
  if (!/Windows/i.test(navigator.userAgent) && !/Win/i.test(navigator.platform || "")) return;

  function selectWindowsTab() {
    var tabs = document.querySelectorAll('[role="tab"]');
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].textContent.trim() === "Windows") {
        if (tabs[i].getAttribute("aria-selected") !== "true") {
          tabs[i].click();
        }
        return true;
      }
    }
    return false;
  }

  // Run at DOMContentLoaded (much earlier than React's useEffect)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", selectWindowsTab);
  } else {
    selectWindowsTab();
  }

  // Re-run on SPA navigation (Mintlify is a Next.js SPA).
  // Only trigger on pathname changes, not on every DOM mutation, to avoid
  // fighting the user if they manually switch away from the Windows tab.
  var lastPath = location.pathname;
  new MutationObserver(function () {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      selectWindowsTab();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
