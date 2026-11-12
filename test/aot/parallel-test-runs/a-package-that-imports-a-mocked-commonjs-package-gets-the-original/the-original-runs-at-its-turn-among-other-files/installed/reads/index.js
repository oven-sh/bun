import "first";
import { value } from "dep";
import "last";
export const seen = () => value() + " " + globalThis.order.join(",");
