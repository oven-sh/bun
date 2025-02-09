import { createRoot } from "react-dom/client";
import { REPLACE_ME_WITH_YOUR_REACT_COMPONENT_EXPORT as Component } from "./REPLACE_ME_WITH_YOUR_APP_BASE_NAME";
import { StrictMode } from "react";

function mount(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <Component />
    </StrictMode>,
  );
}

let root = document.getElementById("root");
if (document.readyState === "complete") {
  mount(root);
} else {
  document.addEventListener("DOMContentLoaded", () => {
    root = document.getElementById("root");
    if (root) {
      mount(root);
    } else {
      throw new Error("No root element found");
    }
  });
}
