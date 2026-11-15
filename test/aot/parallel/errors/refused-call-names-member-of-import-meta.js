// Each line: the message where a member of import.meta that is no function is called or constructed. It names the member as written.
const show = run => {
  try {
    console.log(run());
  } catch (error) {
    console.log(error.name, error.message);
  }
};
import.meta.resolve = null;
import.meta.added = { count: 1 };
show(() => import.meta.resolve());
show(() => import.meta.missing());
show(() => import.meta.added.count());
show(() => import.meta.added.missing());
show(() => import.meta["missing"]());
show(() => import.meta?.missing());
show(() => import.meta.added?.missing());
show(() => import.meta.url.missing());
show(() => new import.meta.missing());
show(() => new import.meta.added.count());
