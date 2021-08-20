import { Main } from "../src/main";

export function getInitialProps() {
  return {};
}

export default function IndexRoute() {
  return (
    <div>
      <Main productName={"Page 2! Next.js (Webpack 5)"} />
    </div>
  );
}
