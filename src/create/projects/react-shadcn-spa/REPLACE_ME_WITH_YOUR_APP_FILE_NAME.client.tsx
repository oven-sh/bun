import { createRoot } from "react-dom/client";
import { REPLACE_ME_WITH_YOUR_REACT_COMPONENT_EXPORT as Component } from "./REPLACE_ME_WITH_YOUR_APP_BASE_NAME";
import { StrictMode } from "react";
// Optionally: import your app's CSS
// import "./styles.css";

function mount(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <Component />
    </StrictMode>,
  );
}

if (document.readyState !== "loading") {
  mount(document.getElementById("root"));
} else {
  document.addEventListener("DOMContentLoaded", () => {
    mount(document.getElementById("root"));
  });
}
