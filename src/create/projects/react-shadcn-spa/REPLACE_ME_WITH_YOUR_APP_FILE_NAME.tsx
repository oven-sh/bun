"use client";
import { useState } from "react";

export function REPLACE_ME_WITH_YOUR_REACT_COMPONENT_EXPORT() {
  const [count, setCount] = useState(0);

  return (
    <div className="container">
      <h1>Hello from Bun!</h1>
      <button onClick={() => setCount(count + 1)}>Count: {count}</button>
    </div>
  );
};
