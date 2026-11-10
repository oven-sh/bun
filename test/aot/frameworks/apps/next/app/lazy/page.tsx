import dynamic from "next/dynamic";

const Late = dynamic(() => import("./late"), { loading: () => <em>loading</em> });

export default function Page() {
  return <main><Late word="dynamic" /></main>;
}
