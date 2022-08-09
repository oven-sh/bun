import { Main } from "../src/main";
export function IndexPage() {
  return (
    <Main
      productName={
        typeof location !== "undefined" ? location.search.substring(1) : ""
      }
    />
  );
}

export default IndexPage;
