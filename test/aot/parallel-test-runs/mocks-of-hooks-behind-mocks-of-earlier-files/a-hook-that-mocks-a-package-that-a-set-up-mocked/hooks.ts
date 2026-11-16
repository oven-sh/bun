import { beforeEach, mock } from "bun:test";
import "./waiter.ts";
let day = 0;
beforeEach(() => {
  const today = ++day;
  mock.module("menu-of-the-day", () => ({ dish: () => "special of day " + today, price: () => 9 }));
});
