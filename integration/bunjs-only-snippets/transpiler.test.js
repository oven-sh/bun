import { expect, it, describe } from "bun:test";

describe("Bun.Transpiler", () => {
  const transpiler = new Bun.Transpiler({
    loader: "tsx",
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
    },
    platform: "browser",
  });

  const code = `import { useParams } from "remix";
  import type { LoaderFunction, ActionFunction } from "remix";
  
  export const loader: LoaderFunction = async ({
    params
  }) => {
    console.log(params.postId);
  };
  
  export const action: ActionFunction = async ({
    params
  }) => {
    console.log(params.postId);
  };
  
  export default function PostRoute() {
    const params = useParams();
    console.log(params.postId);
  }

  `;

  describe("scanImports", () => {
    it("reports import paths, excluding types", () => {
      const imports = transpiler.scanImports(code);
      expect(imports.filter(({ path }) => path === "remix")).toHaveLength(1);
    });
  });

  describe("scan", () => {
    it("reports all export names", () => {
      const { imports, exports } = transpiler.scan(code);

      expect(exports[0]).toBe("loader");
      expect(exports[1]).toBe("action");
      expect(exports[2]).toBe("default");
      expect(exports).toHaveLength(3);
    });
  });
});
