import { heat } from "./kiln";
import { glaze } from "./glaze";
export const pot = () => heat() + "/" + glaze();
