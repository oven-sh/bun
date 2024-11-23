export type PipelineTargetSteps<Step> = {
  getBuildVendorStep: () => Step;
  getBuildCppStep: () => Step;
  getBuildZigStep: () => Step;
  getBuildBunStep: () => Step;
  getTestBunStep: () => Step;
};
