/**
 * Type definitions for Bun SSG (Static Site Generation) modules
 * 
 * This module augmentation allows SSG pages to export properly typed functions
 */

declare module "**/pages/*.tsx" {
  /**
   * Function to generate static paths for dynamic routes
   * 
   * @returns An object containing an array of paths to be statically generated
   * 
   * @example
   * ```tsx
   * export const getStaticPaths: Bun.GetStaticPaths = async () => {
   *   return {
   *     paths: [
   *       { params: { slug: "post-1" } },
   *       { params: { slug: "post-2" } },
   *     ]
   *   };
   * };
   * ```
   */
  export const getStaticPaths: Bun.GetStaticPaths;
  
  /**
   * The default export should be a React component that receives SSG props
   */
  const Component: Bun.SSGPage;
  export default Component;
}