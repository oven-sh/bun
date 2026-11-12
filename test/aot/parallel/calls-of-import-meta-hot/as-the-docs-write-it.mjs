let count = 0;
import.meta.hot.accept();
import.meta.hot.dispose(() => { count = 0; });
console.log("started", count);
