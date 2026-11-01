"use client";
import { useState } from "react";

export function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);
  return <button onClick={() => setCount(count + 1)}>clicked {count} times</button>;
}
