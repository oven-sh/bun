// @bun
import { useState } from "react";
export function useTotal(items) {
  const [factor] = useState(2);
  const scaled = items.map(item => item * factor);
  return { scaled, factor };
}
