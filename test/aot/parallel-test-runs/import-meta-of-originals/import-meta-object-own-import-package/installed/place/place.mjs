const own = import.meta;
import.meta.extra = "kept";
export const isOwn = () => import.meta === own;
export const extra = () => import.meta.extra;
export const meta = () => import.meta;
export const { url } = import.meta;
export const rate = 1;
