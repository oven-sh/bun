// Import required dependencies
import { createRoot } from "react-dom/client";
import * as App from "./REPLACE_ME_WITH_YOUR_APP_BASE_NAME";
import React from "react";

// Get the main component, either from default export or named export
const Component = App.default || App["REPLACE_ME_WITH_YOUR_APP_BASE_NAME"];

// Mount the React application to a DOM element
function mount(root: HTMLElement) {
  createRoot(root).render(
    // Wrap in StrictMode to highlight potential problems
    <React.StrictMode>
      <Component />
    </React.StrictMode>,
  );
}

// Try to get the root element
let root = document.getElementById("root");
if (root) {
  // If root exists, mount immediately
  mount(root);
} else {
  // If root doesn't exist yet, wait for DOM content to load
  document.addEventListener("DOMContentLoaded", () => {
    root = document.getElementById("root");
    if (root) {
      mount(root);
    } else {
      // If still no root element after DOM loads, throw error
      throw new Error("No root element found");
    }
  });
}
