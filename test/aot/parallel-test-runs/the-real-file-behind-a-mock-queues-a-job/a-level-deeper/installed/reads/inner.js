import "early";
import { value } from "dep";
import "late";
export const seen = () => value();
