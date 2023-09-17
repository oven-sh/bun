import { Counter } from "../Counter";
import { Layout } from "../Layout";

export default function () {
  return (
    <Layout title="Settings">
      <Counter />
      <div style={{ height: "20px" }}></div>
      <p>
        <a href="/">Home</a>
      </p>
      <p>
        <a href="/settings">Settings</a>
      </p>
    </Layout>
  );
}
