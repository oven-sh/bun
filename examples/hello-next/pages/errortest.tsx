import IndexPage from "pages/index";

export default function ErrorTestPage() {
  class Wow {}

  const ladee = "",
    foo = { bar: { boom: new Wow() } };

  if (typeof window === "undefined") {
    const Doge = import("wow/such-esm/very-import");
  }

  return <IndexPage />;
}
