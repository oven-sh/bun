import { useEffect } from "react";

export const WindowsTabSelector = () => {
  useEffect(() => {
    const isWindows = /Windows/i.test(navigator.userAgent) || /Win/i.test(navigator.platform || "");
    if (!isWindows) return;

    function trySelectWindowsTab() {
      const tabs = document.querySelectorAll('[role="tab"]');
      for (const tab of tabs) {
        if (tab.textContent.trim() === "Windows") {
          tab.click();
          return true;
        }
      }
      return false;
    }

    if (!trySelectWindowsTab()) {
      const observer = new MutationObserver(() => {
        if (trySelectWindowsTab()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 5000);
    }
  }, []);

  return null;
};
