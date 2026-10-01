// Ground truth for the path functions: copies of internal/tspath/path.go by line range, standard library only.
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

const (
	DirectorySeparator = '/'
	urlSchemeSeparator = "://"
)

// ---- internal/tspath/path.go:27-29 (verbatim) ----
func isAnyDirectorySeparator(char byte) bool {
	return char == '/' || char == '\\'
}

// ---- internal/tspath/path.go:38-40 (verbatim) ----
func IsRootedDiskPath(path string) bool {
	return GetEncodedRootLength(path) > 0
}

// ---- internal/tspath/path.go:71-73 (verbatim) ----
func HasTrailingDirectorySeparator(path string) bool {
	return len(path) > 0 && isAnyDirectorySeparator(path[len(path)-1])
}

// ---- internal/tspath/path.go:91-132 (verbatim) ----
func CombinePaths(firstPath string, paths ...string) string {
	// TODO (drosen): There is potential for a fast path here.
	// In the case where we find the last absolute path and just path.Join from there.
	firstPath = NormalizeSlashes(firstPath)

	var b strings.Builder
	size := len(firstPath) + len(paths)
	for _, p := range paths {
		size += len(p)
	}
	b.Grow(size)

	b.WriteString(firstPath)

	// To provide a way to "set" the path, keep track of the start and then slice.
	// This will waste some memory each time we do it, but saving memory is more common.
	start := 0
	result := func() string {
		return b.String()[start:]
	}
	setResult := func(value string) {
		start = b.Len()
		b.WriteString(value)
	}

	for _, trailingPath := range paths {
		if trailingPath == "" {
			continue
		}
		trailingPath = NormalizeSlashes(trailingPath)
		if result() == "" || GetRootLength(trailingPath) != 0 {
			// `trailingPath` is absolute.
			setResult(trailingPath)
		} else {
			if !HasTrailingDirectorySeparator(result()) {
				b.WriteByte(DirectorySeparator)
			}
			b.WriteString(trailingPath)
		}
	}
	return result()
}

// ---- internal/tspath/path.go:148-150 (verbatim) ----
func IsVolumeCharacter(char byte) bool {
	return char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z'
}

// ---- internal/tspath/path.go:152-167 (verbatim) ----
func getFileUrlVolumeSeparatorEnd(url string, start int) int {
	if len(url) <= start {
		return -1
	}
	ch0 := url[start]
	if ch0 == ':' {
		return start + 1
	}
	if ch0 == '%' && len(url) > start+2 && url[start+1] == '3' {
		ch2 := url[start+2]
		if ch2 == 'a' || ch2 == 'A' {
			return start + 3
		}
	}
	return -1
}

// ---- internal/tspath/path.go:169-241 (verbatim) ----
func GetEncodedRootLength(path string) int {
	ln := len(path)
	if ln == 0 {
		return 0
	}
	ch0 := path[0]

	// POSIX or UNC
	if ch0 == '/' || ch0 == '\\' {
		if ln == 1 || path[1] != ch0 {
			return 1 // POSIX: "/" (or non-normalized "\")
		}

		offset := 2
		p1 := strings.IndexByte(path[offset:], ch0)
		if p1 < 0 {
			return ln // UNC: "//server" or "\\server"
		}

		return p1 + offset + 1 // UNC: "//server/" or "\\server\"
	}

	// DOS
	if IsVolumeCharacter(ch0) && ln > 1 && path[1] == ':' {
		if ln == 2 {
			return 2 // DOS: "c:" (but not "c:d")
		}
		ch2 := path[2]
		if ch2 == '/' || ch2 == '\\' {
			return 3 // DOS: "c:/" or "c:\"
		}
	}

	// Untitled paths (e.g., "^/untitled/ts-nul-authority/Untitled-1")
	if ch0 == '^' && ln > 1 && path[1] == '/' {
		return 2 // Untitled: "^/"
	}

	// URL
	schemeEnd := strings.Index(path, urlSchemeSeparator)
	if schemeEnd != -1 {
		authorityStart := schemeEnd + len(urlSchemeSeparator)
		authorityLength := strings.Index(path[authorityStart:], "/")
		if authorityLength != -1 { // URL: "file:///", "file://server/", "file://server/path"
			authorityEnd := authorityStart + authorityLength

			// For local "file" URLs, include the leading DOS volume (if present).
			// Per https://www.ietf.org/rfc/rfc1738.txt, a host of "" or "localhost" is a
			// special case interpreted as "the machine from which the URL is being interpreted".
			scheme := path[:schemeEnd]
			authority := path[authorityStart:authorityEnd]
			if scheme == "file" && (authority == "" || authority == "localhost") && (len(path) > authorityEnd+2) && IsVolumeCharacter(path[authorityEnd+1]) {
				volumeSeparatorEnd := getFileUrlVolumeSeparatorEnd(path, authorityEnd+2)
				if volumeSeparatorEnd != -1 {
					if volumeSeparatorEnd == len(path) {
						// URL: "file:///c:", "file://localhost/c:", "file:///c$3a", "file://localhost/c%3a"
						// but not "file:///c:d" or "file:///c%3ad"
						return ^volumeSeparatorEnd
					}
					if path[volumeSeparatorEnd] == '/' {
						// URL: "file:///c:/", "file://localhost/c:/", "file:///c%3a/", "file://localhost/c%3a/"
						return ^(volumeSeparatorEnd + 1)
					}
				}
			}
			return ^(authorityEnd + 1) // URL: "file://server/", "http://server/"
		}
		return ^ln // URL: "file://server", "http://server"
	}

	// relative
	return 0
}

// ---- internal/tspath/path.go:243-249 (verbatim) ----
func GetRootLength(path string) int {
	rootLength := GetEncodedRootLength(path)
	if rootLength < 0 {
		return ^rootLength
	}
	return rootLength
}

// ---- internal/tspath/path.go:251-264 (verbatim) ----
func GetDirectoryPath(path string) string {
	path = NormalizeSlashes(path)

	// If the path provided is itself a root, then return it.
	rootLength := GetRootLength(path)
	if rootLength == len(path) {
		return path
	}

	// return the leading portion of the path up to the last (non-terminal) directory separator
	// but not including any trailing directory separator.
	path = RemoveTrailingDirectorySeparator(path)
	return path[:max(rootLength, strings.LastIndex(path, "/"))]
}

// ---- internal/tspath/path.go:283-285 (verbatim) ----
func NormalizeSlashes(path string) string {
	return strings.ReplaceAll(path, "\\", "/")
}

// ---- internal/tspath/path.go:394-513 (verbatim) ----
func GetNormalizedAbsolutePath(fileName string, currentDirectory string) string {
	rootLength := GetRootLength(fileName)
	if rootLength == 0 && currentDirectory != "" {
		fileName = CombinePaths(currentDirectory, fileName)
	} else {
		// CombinePaths normalizes slashes, so not necessary in other branch
		fileName = NormalizeSlashes(fileName)
	}
	rootLength = GetRootLength(fileName)

	if simpleNormalized, ok := simpleNormalizePath(fileName); ok {
		length := len(simpleNormalized)
		if length > rootLength {
			return RemoveTrailingDirectorySeparator(simpleNormalized)
		}
		if length == rootLength && rootLength != 0 {
			return EnsureTrailingDirectorySeparator(simpleNormalized)
		}
		return simpleNormalized
	}

	length := len(fileName)
	root := fileName[:rootLength]
	// `normalized` is only initialized once `fileName` is determined to be non-normalized.
	// `changed` is set at the same time.
	var changed bool
	var normalized string
	var segmentStart int
	index := rootLength
	normalizedUpTo := index
	seenNonDotDotSegment := rootLength != 0
	for index < length {
		// At beginning of segment
		segmentStart = index
		ch := fileName[index]
		for ch == '/' {
			index++
			if index < length {
				ch = fileName[index]
			} else {
				break
			}
		}
		if index > segmentStart {
			// Seen superfluous separator
			if !changed {
				normalized = fileName[:max(rootLength, segmentStart-1)]
				changed = true
			}
			if index == length {
				break
			}
			segmentStart = index
		}
		// Past any superfluous separators
		segmentEnd := strings.IndexByte(fileName[index+1:], '/')
		if segmentEnd == -1 {
			segmentEnd = length
		} else {
			segmentEnd += index + 1
		}
		segmentLength := segmentEnd - segmentStart
		if segmentLength == 1 && fileName[index] == '.' {
			// "." segment (skip)
			if !changed {
				normalized = fileName[:normalizedUpTo]
				changed = true
			}
		} else if segmentLength == 2 && fileName[index] == '.' && fileName[index+1] == '.' {
			// ".." segment
			if !seenNonDotDotSegment {
				if changed {
					if len(normalized) == rootLength {
						normalized += ".."
					} else {
						normalized += "/.."
					}
				} else {
					normalizedUpTo = index + 2
				}
			} else if !changed {
				if normalizedUpTo-1 >= 0 {
					normalized = fileName[:max(rootLength, strings.LastIndexByte(fileName[:normalizedUpTo-1], '/'))]
				} else {
					normalized = fileName[:normalizedUpTo]
				}
				changed = true
				seenNonDotDotSegment = (len(normalized) != rootLength || rootLength != 0) && normalized != ".." && !strings.HasSuffix(normalized, "/..")
			} else {
				lastSlash := strings.LastIndexByte(normalized, '/')
				if lastSlash != -1 {
					normalized = normalized[:max(rootLength, lastSlash)]
				} else {
					normalized = root
				}
				seenNonDotDotSegment = (len(normalized) != rootLength || rootLength != 0) && normalized != ".." && !strings.HasSuffix(normalized, "/..")
			}
		} else if changed {
			if len(normalized) != rootLength {
				normalized += "/"
			}
			seenNonDotDotSegment = true
			normalized += fileName[segmentStart:segmentEnd]
		} else {
			seenNonDotDotSegment = true
			normalizedUpTo = segmentEnd
		}
		index = segmentEnd + 1
	}
	if changed {
		return normalized
	}
	if length > rootLength {
		return RemoveTrailingDirectorySeparators(fileName)
	}
	if length == rootLength {
		return EnsureTrailingDirectorySeparator(fileName)
	}
	return fileName
}

// ---- internal/tspath/path.go:515-529 (verbatim) ----
func simpleNormalizePath(path string) (string, bool) {
	// Most paths don't require normalization
	if !hasRelativePathSegment(path) {
		return path, true
	}
	// Some paths only require cleanup of `/./` or leading `./`
	simplified := strings.ReplaceAll(path, "/./", "/")
	trimmed := strings.TrimPrefix(simplified, "./")
	if trimmed != path && !hasRelativePathSegment(trimmed) && !(trimmed != simplified && strings.HasPrefix(trimmed, "/")) {
		// If we trimmed a leading "./" and the path now starts with "/", we changed the meaning
		path = trimmed
		return path, true
	}
	return "", false
}

// ---- internal/tspath/path.go:532-598 (verbatim) ----
func hasRelativePathSegment(p string) bool {
	n := len(p)
	if n == 0 {
		return false
	}

	if p == "." || p == ".." {
		return true
	}

	// Leading "./" OR "../"
	if p[0] == '.' {
		if n >= 2 && p[1] == '/' {
			return true
		}
		// Leading "../"
		if n >= 3 && p[1] == '.' && p[2] == '/' {
			return true
		}
	}
	// Trailing "/." OR "/.."
	if p[n-1] == '.' {
		if n >= 2 && p[n-2] == '/' {
			return true
		}
		if n >= 3 && p[n-2] == '.' && p[n-3] == '/' {
			return true
		}
	}

	// Now look for any `//` or `/./` or `/../`

	prevSlash := false
	segLen := 0   // length of current segment since last slash
	dotCount := 0 // consecutive dots at start of the current segment; -1 => not only dots

	for i := range n {
		c := p[i]
		if c == '/' {
			// "//"
			if prevSlash {
				return true
			}
			// "/./" or "/../"
			if (segLen == 1 && dotCount == 1) || (segLen == 2 && dotCount == 2) {
				return true
			}
			prevSlash = true
			segLen = 0
			dotCount = 0
			continue
		}

		if c == '.' {
			if dotCount >= 0 {
				dotCount++
			}
		} else {
			dotCount = -1
		}
		segLen++
		prevSlash = false
	}

	// Trailing "/." or "/.."
	return (segLen == 1 && dotCount == 1) || (segLen == 2 && dotCount == 2)
}

// ---- internal/tspath/path.go:600-610 (verbatim) ----
func NormalizePath(path string) string {
	path = NormalizeSlashes(path)
	if normalized, ok := simpleNormalizePath(path); ok {
		return normalized
	}
	normalized := GetNormalizedAbsolutePath(path, "")
	if normalized != "" && HasTrailingDirectorySeparator(path) {
		normalized = EnsureTrailingDirectorySeparator(normalized)
	}
	return normalized
}

// ---- internal/tspath/path.go:733-738 (verbatim) ----
func RemoveTrailingDirectorySeparator(path string) string {
	if HasTrailingDirectorySeparator(path) {
		return path[:len(path)-1]
	}
	return path
}

// ---- internal/tspath/path.go:744-749 (verbatim) ----
func RemoveTrailingDirectorySeparators(path string) string {
	for HasTrailingDirectorySeparator(path) {
		path = RemoveTrailingDirectorySeparator(path)
	}
	return path
}

// ---- internal/tspath/path.go:751-757 (verbatim) ----
func EnsureTrailingDirectorySeparator(path string) string {
	if !HasTrailingDirectorySeparator(path) {
		return path + "/"
	}

	return path
}

// ---- internal/tspath/path.go:876-889 (verbatim) ----
func GetBaseFileName(path string) string {
	path = NormalizeSlashes(path)

	// if the path provided is itself the root, then it has no file name.
	rootLength := GetRootLength(path)
	if rootLength == len(path) {
		return ""
	}

	// return the trailing portion of the path starting after the last (non-terminal) directory
	// separator but not including any trailing directory separator.
	path = RemoveTrailingDirectorySeparator(path)
	return path[max(GetRootLength(path), strings.LastIndex(path, string(DirectorySeparator))+1):]
}

// ToPath of the reference for a case sensitive file system (path.go:723 with GetCanonicalFileName as the identity).
func toPathCaseSensitive(fileName string, basePath string) string {
	if IsRootedDiskPath(fileName) {
		return NormalizePath(fileName)
	}
	return GetNormalizedAbsolutePath(fileName, basePath)
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
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		name, dir, _ := strings.Cut(line, "\t")
		fmt.Fprintf(w, "%s\t%s\t%q\t%q\t%q\t%q\t%v\t%q\t%q\n", name, dir,
			GetNormalizedAbsolutePath(name, dir), NormalizePath(name), GetDirectoryPath(name), toPathCaseSensitive(name, dir),
			IsRootedDiskPath(name), CombinePaths(dir, name), GetBaseFileName(name))
	}
}
