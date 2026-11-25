import "first";
import { value, other } from "dep";
import "last";
export const seen = () => value() + " " + other();
