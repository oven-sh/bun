import { Main } from "../src/main";
import { Button } from "../src/components/button";

export function getInitialProps() {
  return {};
}

export default function IndexRoute() {
  return (
    <div>
      <Main productName={"Next.js (Webpack 5)"} />;<Button>hello</Button>
    </div>
  );
}
