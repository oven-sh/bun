export let count = 0;
import.meta.hot.accept();
import.meta.hot.dispose(() => { count = -1; });
export const kept = (import.meta.hot.data.kept ??= "made anew");
