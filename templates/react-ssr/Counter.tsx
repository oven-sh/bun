import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ display: "flex" }}>
      <button
        style={{ cursor: "pointer", border: "none", borderRadius: "4px", width: "20px" }}
        onClick={() => setCount(count - 1)}
      >
        -
      </button>
      <span style={{ paddingLeft: "10px", paddingRight: "10px", fontSize: "14pt", fontFamily: "monospace" }}>
        {count}
      </span>
      <button
        style={{ cursor: "pointer", border: "none", borderRadius: "4px", width: "20px" }}
        onClick={() => {
          setCount(count + 1);
        }}
      >
        +
      </button>
    </div>
  );
}
