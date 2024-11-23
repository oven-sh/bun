export type BuildkiteBuild = {
  id: string;
  commit_id: string;
  branch_name: string;
  state?: string;
  path?: string;
};
