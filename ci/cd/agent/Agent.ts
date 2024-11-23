export type Os = "linux" | "darwin" | "windows";
export type Arch = "aarch64" | "x64";
export type Abi = "musl";

export type Agent = {
  queue?: string;
  os?: Os;
  arch?: Arch;
  abi?: Abi;
  distro?: string;
  release?: string;
  "image-name"?: string;
  "instance-type"?: string;
  robobun?: boolean;
  robobun2?: boolean;
};
