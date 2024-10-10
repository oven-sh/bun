import type { ActionFunction, LoaderFunction } from "remix";
import { useParams } from "remix";

export const loader: LoaderFunction = async ({ params }) => {
  console.log(params.postId);
};

export const action: ActionFunction = async ({ params }) => {
  console.log(params.postId);
};

export default function PostRoute() {
  const params = useParams();
  console.log(params.postId);
}
