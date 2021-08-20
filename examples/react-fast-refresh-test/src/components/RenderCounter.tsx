import React from "react";

export function RenderCounter({ name, children }) {
  const counter = React.useRef(1);
  return (
    <div className="RenderCounter">
      <div className="RenderCounter-meta">
        <div className="RenderCounter-title">
          {name} rendered <strong>{counter.current++} times</strong>
        </div>
        <div className="RenderCounter-lastRender">
          LAST RENDER:{" "}
          {new Intl.DateTimeFormat([], {
            timeStyle: "long",
          }).format(new Date())}
        </div>
      </div>
      <div className="RenderCounter-children">{children}</div>
    </div>
  );
}
