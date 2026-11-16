import { dish, price } from "./menu.ts";
export const order = () => dish() + " for " + price();
