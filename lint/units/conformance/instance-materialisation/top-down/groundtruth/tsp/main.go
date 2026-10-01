// Ground truth for the path functions that the roots split, the config matcher and the path mapping call: the real internal/tspath.
package main

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"

	"github.com/microsoft/typescript-go/internal/tspath"
)

type row struct {
	Name                    string   `json:"name"`
	Dir                     string   `json:"dir"`
	NormalizedAbsolutePath  string   `json:"getNormalizedAbsolutePath"`
	NormalizePath           string   `json:"normalizePath"`
	DirectoryPath           string   `json:"getDirectoryPath"`
	BaseFileName            string   `json:"getBaseFileName"`
	RootLength              int      `json:"getRootLength"`
	EncodedRootLength       int      `json:"getEncodedRootLength"`
	IsRootedDiskPath        bool     `json:"isRootedDiskPath"`
	CombinePaths            string   `json:"combinePaths"`
	ToPathSensitive         string   `json:"toPathCaseSensitive"`
	ToPathInsensitive       string   `json:"toPathCaseInsensitive"`
	AnyExtension            string   `json:"getAnyExtensionFromPath"`
	HasExtension            bool     `json:"hasExtension"`
	IsDts                   bool     `json:"fileExtensionIsDts"`
	IsJson                  bool     `json:"fileExtensionIsJson"`
	IsTsBuildInfo           bool     `json:"fileExtensionIsTsBuildInfo"`
	ChangeExtensionTs       string   `json:"changeExtensionTs"`
	NormalizedComponents    []string `json:"getNormalizedPathComponents"`
	PathComponents          []string `json:"getPathComponents"`
	ContainsPath            bool     `json:"containsPathDirName"`
	ContainsPathReverse     bool     `json:"containsPathNameDir"`
	ConvertToRelativePath   string   `json:"convertToRelativePath"`
	LowerCase               string   `json:"toFileNameLowerCase"`
	RemoveTrailingSeparator string   `json:"removeTrailingDirectorySeparator"`
}

func main() {
	in, err := os.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer in.Close()
	out, err := os.Create(os.Args[2])
	if err != nil {
		panic(err)
	}
	defer out.Close()
	w := bufio.NewWriterSize(out, 1<<20)
	defer w.Flush()
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var pair [2]string
		if err := json.Unmarshal([]byte(sc.Text()), &pair); err != nil {
			panic(err)
		}
		name, dir := pair[0], pair[1]
		opts := tspath.ComparePathsOptions{UseCaseSensitiveFileNames: true, CurrentDirectory: dir}
		r := row{Name: name, Dir: dir}
		r.NormalizedAbsolutePath = tspath.GetNormalizedAbsolutePath(name, dir)
		r.NormalizePath = tspath.NormalizePath(name)
		r.DirectoryPath = tspath.GetDirectoryPath(name)
		r.BaseFileName = tspath.GetBaseFileName(name)
		r.RootLength = tspath.GetRootLength(name)
		r.EncodedRootLength = tspath.GetEncodedRootLength(name)
		r.IsRootedDiskPath = tspath.IsRootedDiskPath(name)
		r.CombinePaths = tspath.CombinePaths(dir, name)
		r.ToPathSensitive = string(tspath.ToPath(name, dir, true))
		r.ToPathInsensitive = string(tspath.ToPath(name, dir, false))
		r.AnyExtension = tspath.GetAnyExtensionFromPath(name, nil, false)
		r.HasExtension = tspath.HasExtension(name)
		r.IsDts = tspath.FileExtensionIs(name, tspath.ExtensionDts)
		r.IsJson = tspath.FileExtensionIs(name, tspath.ExtensionJson)
		r.IsTsBuildInfo = tspath.FileExtensionIs(name, tspath.ExtensionTsBuildInfo)
		r.ChangeExtensionTs = tspath.ChangeExtension(name, ".ts")
		r.NormalizedComponents = tspath.GetNormalizedPathComponents(name, dir)
		r.PathComponents = tspath.GetPathComponents(name, dir)
		r.ContainsPath = tspath.ContainsPath(dir, name, opts)
		r.ContainsPathReverse = tspath.ContainsPath(name, dir, opts)
		func() {
			defer func() {
				if e := recover(); e != nil {
					r.ConvertToRelativePath = "panic"
				}
			}()
			r.ConvertToRelativePath = tspath.ConvertToRelativePath(name, opts)
		}()
		r.LowerCase = tspath.ToFileNameLowerCase(name)
		r.RemoveTrailingSeparator = tspath.RemoveTrailingDirectorySeparator(name)
		_ = strings.ToLower
		enc.Encode(r)
	}
}
