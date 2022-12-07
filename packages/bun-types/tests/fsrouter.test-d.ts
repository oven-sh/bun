import { FileSystemRouter } from "bun";
import { expectType } from "tsd";

const router = new FileSystemRouter({
  dir: import.meta.dir + "/pages",
  style: "nextjs",
});

const match = router.match("/");
expectType<string>(match?.name!);
expectType<string>(match?.pathname!);
expectType<Record<string, string>>(match?.query!);
expectType<Record<string, string>>(match?.params!);
