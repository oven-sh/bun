import { useState } from "react";
export function useSum(items) {
  const [factor] = useState(2);
  const scaled = items.map(item => item * factor);
  return { scaled, factor };
}
